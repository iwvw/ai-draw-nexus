package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"ai-draw-nexus/internal/ai"
	"ai-draw-nexus/internal/db"
)

// chatBody /api/chat 请求体。
type chatBody struct {
	Messages  []ai.Message `json:"messages"`
	Stream    bool         `json:"stream"`
	LlmConfig *ai.LlmConfig `json:"llmConfig"`
}

// llmConfigBody /api/models 请求体（可选 llmConfig）。
type llmConfigBody struct {
	LlmConfig *ai.LlmConfig `json:"llmConfig"`
}

// resolveEnv 解析生效 AI 环境。
func (a *App) resolveEnv(user *db.User, bodyCfg *ai.LlmConfig) ai.EffectiveEnv {
	base := ai.Defaults(a.Cfg.AIProvider, a.Cfg.AIBaseURL, a.Cfg.AIAPIKey, a.Cfg.AIModelID)
	if bodyCfg != nil && bodyCfg.APIKey != "" {
		return base.ApplyConfig(bodyCfg)
	}
	if user != nil {
		if cfg := a.Store.UserLlmConfig(user.ID); cfg != nil && cfg.APIKey != "" {
			return base.ApplyConfig(toAIConfigAI(cfg))
		}
	}
	if cfg := a.Store.WorkspaceLlmConfig(); cfg != nil && cfg.APIKey != "" {
		return base.ApplyConfig(toAIConfigAI(cfg))
	}
	return base
}

// resolveEnvForUser 按用户 ID 解析生效 AI 环境（供异步任务 worker 使用）。
func (a *App) resolveEnvForUser(userID string) ai.EffectiveEnv {
	base := ai.Defaults(a.Cfg.AIProvider, a.Cfg.AIBaseURL, a.Cfg.AIAPIKey, a.Cfg.AIModelID)
	if cfg := a.Store.UserLlmConfig(userID); cfg != nil && cfg.APIKey != "" {
		return base.ApplyConfig(toAIConfigAI(cfg))
	}
	if cfg := a.Store.WorkspaceLlmConfig(); cfg != nil && cfg.APIKey != "" {
		return base.ApplyConfig(toAIConfigAI(cfg))
	}
	return base
}

func toAIConfigAI(c *db.LlmConfig) *ai.LlmConfig {
	return &ai.LlmConfig{Provider: c.Provider, BaseURL: c.BaseURL, APIKey: c.APIKey, ModelID: c.ModelID}
}

// handleChat POST /api/chat/
func (a *App) handleChat(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	var body chatBody
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求无效：缺少消息列表")
		return
	}
	if len(body.Messages) == 0 {
		writeError(w, http.StatusBadRequest, "请求无效：缺少消息列表")
		return
	}
	env := a.resolveEnv(user, body.LlmConfig)

	if body.Stream {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
err := ai.Stream(r.Context(), w, func() {
		if flusher != nil {
			flusher.Flush()
		}
	}, body.Messages, env)
	if err != nil {
		// 上游错误：SSE 流已开启，无法再改状态码，写一条 error 事件透传前端，
		// 避免前端误以为"生成了空内容"。
		prefixed := strings.ReplaceAll(err.Error(), "\n", " ")
		event, _ := json.Marshal(map[string]string{"error": prefixed})
		fmt.Fprintf(w, "data: %s\n\n", event)
		if flusher != nil {
			flusher.Flush()
		}
		return
	}
		return
	}

	content, err := ai.Call(r.Context(), body.Messages, env)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": content})
}

// handleModels POST /api/models/
func (a *App) handleModels(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	var body llmConfigBody
	_ = decodeBody(r, &body)
	env := a.resolveEnv(user, body.LlmConfig)

	if env.Provider == "anthropic" {
		writeJSON(w, http.StatusOK, map[string]any{"data": []map[string]string{
			{"id": "claude-3-opus-20240229"},
			{"id": "claude-3-sonnet-20240229"},
			{"id": "claude-3-haiku-20240307"},
			{"id": "claude-3-5-sonnet-20240620"},
		}})
		return
	}

	base := strings.TrimSuffix(strings.TrimSuffix(env.BaseURL, "/chat/completions"), "/")
	resp, err := forwardModelsGet(base+"/models", env.APIKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		writeError(w, http.StatusInternalServerError, "获取模型列表失败")
		return
	}
	var out any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		writeError(w, http.StatusInternalServerError, "未知错误")
		return
	}
	writeJSON(w, resp.StatusCode, out)
}

// forwardModelsGet 转发 GET 到模型列表端点。
func forwardModelsGet(url, apiKey string) (*http.Response, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	return http.DefaultClient.Do(req)
}