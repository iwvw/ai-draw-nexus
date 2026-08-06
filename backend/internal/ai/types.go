// Package ai 提供 LLM 调用、流式转发与配置解析（对齐 TS server/ai）。
package ai

import "strings"

// Message 对应 TS Message，content 可为字符串或 ContentPart 数组。
type Message struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

// LlmConfig 是用户/工作区保存的 LLM 配置。
type LlmConfig struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"baseUrl"`
	APIKey   string `json:"apiKey"`
	ModelID  string `json:"modelId"`
}

// EffectiveEnv 解析后的生效 AI 环境。
type EffectiveEnv struct {
	Provider string
	BaseURL  string
	APIKey   string
	ModelID  string
}

// Defaults 返回基于环境变量的默认环境。
func Defaults(provider, baseURL, apiKey, modelID string) EffectiveEnv {
	if provider == "" {
		provider = "openai"
	}
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	if modelID == "" {
		modelID = "gpt-4o-mini"
	}
	return EffectiveEnv{Provider: provider, BaseURL: baseURL, APIKey: apiKey, ModelID: modelID}
}

// ApplyConfig 若 config 带 apiKey 则用其覆盖默认值。
func (e EffectiveEnv) ApplyConfig(cfg *LlmConfig) EffectiveEnv {
	if cfg == nil || cfg.APIKey == "" {
		return e
	}
	out := e
	if cfg.Provider != "" {
		out.Provider = cfg.Provider
	}
	if cfg.BaseURL != "" {
		out.BaseURL = cfg.BaseURL
	}
	out.APIKey = cfg.APIKey
	if cfg.ModelID != "" {
		out.ModelID = cfg.ModelID
	}
	return out
}

// contentAsString 若 content 是字符串则返回，否则返回 ""。
func contentAsString(c any) string {
	if s, ok := c.(string); ok {
		return s
	}
	return ""
}

// contentAsParts 若 content 是 map 数组（ContentPart），返回。
func contentAsParts(c any) []map[string]any {
	if arr, ok := c.([]any); ok {
		out := []map[string]any{}
		for _, item := range arr {
			if m, ok := item.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

// anthropicContent 把 content 转为 Anthropic 消息内容（string 或 parts）。
func anthropicContent(c any) any {
	if s, ok := c.(string); ok {
		return s
	}
	parts := contentAsParts(c)
	if parts == nil {
		return c
	}
	out := []any{}
	for _, p := range parts {
		switch p["type"] {
		case "image_url":
			img, _ := p["image_url"].(map[string]any)
			url, _ := img["url"].(string)
			if strings.HasPrefix(url, "data:") && strings.Contains(url, ";base64,") {
				idx := strings.Index(url, ";base64,")
				mediaType := url[5:idx]
				data := url[idx+len(";base64,"):]
				out = append(out, map[string]any{
					"type": "image",
					"source": map[string]any{
						"type": "base64", "media_type": mediaType, "data": data,
					},
				})
			} else {
				out = append(out, map[string]any{"type": "text", "text": "[Image URL: " + url + "]"})
			}
		default:
			text, _ := p["text"].(string)
			out = append(out, map[string]any{"type": "text", "text": text})
		}
	}
	return out
}

// splitMessages 把消息拆成 system 与其余。
func splitMessages(messages []Message) (system string, rest []Message) {
	for _, m := range messages {
		if m.Role == "system" {
			if s := contentAsString(m.Content); s != "" {
				system = s
			}
			continue
		}
		rest = append(rest, m)
	}
	return system, rest
}