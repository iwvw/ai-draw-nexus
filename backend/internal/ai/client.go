package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var httpClient = &http.Client{Timeout: 5 * time.Minute}

// postJSON 发送 JSON POST，返回原始响应（调用方负责 Close）。
func postJSON(ctx context.Context, url string, headers map[string]string, body any) (*http.Response, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return httpClient.Do(req)
}

// Call 非流式调用，返回模型文本。
func Call(ctx context.Context, messages []Message, env EffectiveEnv) (string, error) {
	if env.APIKey == "" {
		return "", fmt.Errorf("未配置 AI_API_KEY")
	}
	if env.Provider == "anthropic" {
		return callAnthropicNonStream(ctx, messages, env)
	}
	return callOpenAINonStream(ctx, messages, env)
}

func callOpenAINonStream(ctx context.Context, messages []Message, env EffectiveEnv) (string, error) {
	payload := map[string]any{
		"model": env.ModelID, "messages": messages, "max_tokens": 64000, "stream": false,
	}
	resp, err := postJSON(ctx, env.BaseURL+"/chat/completions",
		map[string]string{"Authorization": "Bearer " + env.APIKey}, payload)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("OpenAI API 错误：%s", strings.TrimSpace(string(b)))
	}
	var data struct {
		Choices []struct {
			Message struct{ Content string `json:"content"` } `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	if len(data.Choices) > 0 {
		return data.Choices[0].Message.Content, nil
	}
	return "", nil
}

func callAnthropicNonStream(ctx context.Context, messages []Message, env EffectiveEnv) (string, error) {
	system, rest := splitMessages(messages)
	anthropicMsgs := []any{}
	for _, m := range rest {
		anthropicMsgs = append(anthropicMsgs, map[string]any{"role": m.Role, "content": anthropicContent(m.Content)})
	}
	payload := map[string]any{
		"model": env.ModelID, "max_tokens": 64000, "system": system, "messages": anthropicMsgs,
	}
	resp, err := postJSON(ctx, env.BaseURL+"/messages",
		map[string]string{"x-api-key": env.APIKey, "anthropic-version": "2023-06-01"}, payload)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("Anthropic API 错误：%s", strings.TrimSpace(string(b)))
	}
	var data struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	for _, c := range data.Content {
		if c.Text != "" {
			return c.Text, nil
		}
	}
	return "", nil
}

// Stream 流式：读上游 SSE，把提取的文本写入 w 并逐个 flush。
func Stream(ctx context.Context, w io.Writer, flush func(), messages []Message, env EffectiveEnv) error {
	if env.APIKey == "" {
		return fmt.Errorf("未配置 AI_API_KEY")
	}
	if env.Provider == "anthropic" {
		return streamAnthropic(ctx, w, flush, messages, env)
	}
	return streamOpenAI(ctx, w, flush, messages, env)
}

func streamOpenAI(ctx context.Context, w io.Writer, flush func(), messages []Message, env EffectiveEnv) error {
	payload := map[string]any{
		"model": env.ModelID, "messages": messages, "max_tokens": 64000, "stream": true,
	}
	resp, err := postJSON(ctx, env.BaseURL+"/chat/completions",
		map[string]string{"Authorization": "Bearer " + env.APIKey}, payload)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("OpenAI API 错误：%s", strings.TrimSpace(string(b)))
	}
	return copySSEAsText(resp.Body, w, flush, extractOpenAIText)
}

func streamAnthropic(ctx context.Context, w io.Writer, flush func(), messages []Message, env EffectiveEnv) error {
	system, rest := splitMessages(messages)
	anthropicMsgs := []any{}
	for _, m := range rest {
		anthropicMsgs = append(anthropicMsgs, map[string]any{"role": m.Role, "content": anthropicContent(m.Content)})
	}
	payload := map[string]any{
		"model": env.ModelID, "max_tokens": 64000, "stream": true, "system": system, "messages": anthropicMsgs,
	}
	resp, err := postJSON(ctx, env.BaseURL+"/messages",
		map[string]string{"x-api-key": env.APIKey, "anthropic-version": "2023-06-01"}, payload)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("Anthropic API 错误：%s", strings.TrimSpace(string(b)))
	}
	return copySSEAsText(resp.Body, w, flush, extractAnthropicText)
}

// copySSEAsText 逐行读 src，对每个合法 `data:` JSON 提取文本并写入 w。
func copySSEAsText(src io.Reader, w io.Writer, flush func(), extract func([]byte) string) error {
	scanner := bufio.NewScanner(src)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		if !json.Valid([]byte(payload)) {
			continue
		}
		text := extract([]byte(payload))
		if text == "" {
			continue
		}
		if _, err := w.Write([]byte(text)); err != nil {
			return err
		}
		flush()
	}
	return scanner.Err()
}

func extractOpenAIText(data []byte) string {
	var chunk struct {
		Choices []struct {
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &chunk); err != nil {
		return ""
	}
	for _, c := range chunk.Choices {
		if c.Delta.Content != "" {
			return c.Delta.Content
		}
	}
	return ""
}

func extractAnthropicText(data []byte) string {
	var chunk struct {
		Type  string `json:"type"`
		Delta *struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"delta"`
	}
	if err := json.Unmarshal(data, &chunk); err != nil {
		return ""
	}
	if chunk.Type == "content_block_delta" && chunk.Delta != nil {
		if (chunk.Delta.Type == "text_delta" || chunk.Delta.Type == "text") && chunk.Delta.Text != "" {
			return chunk.Delta.Text
		}
	}
	return ""
}