package server

import (
	"net/http"
	"strings"

	"ai-draw-nexus/internal/ai"
	"ai-draw-nexus/internal/db"
)

// aiUsage 中间件（挂载于所有消耗 LLM 配额的端点：/api/chat、
// /api/v1/generate、/api/generate-tasks、MCP generate_diagram）：
// 在进入 handler 前进行配额检查并「预留」配额，handler 完成后释放预留并
// 写 ai_usage 记录。预留机制避免并发请求同时通过检查导致配额超卖。
// 豁免条件：
// 1. X-Access-Password == ACCESS_PASSWORD（配置在 cfg）
// 2. 用户已保存 llm.config 且带 apiKey
func (a *App) aiUsage(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			next.ServeHTTP(w, r)
			return
		}
		user := ctxUser(r)
		var userID string
		if user != nil {
			userID = user.ID
		}

		exempt := a.requestExempt(r, user)

		reserved := 0
		if userID != "" && !exempt {
			if !a.reserveQuota(userID) {
				writeError(w, http.StatusTooManyRequests, "今日 AI 配额已用完")
				return
			}
			reserved = 1
		}
		// 无论 handler 是否 panic（Recoverer 在 aiUsage 外层），都保证释放预留，
		// 避免 quotaPending 泄漏导致配额被持续占用。
		defer func() {
			if reserved == 1 {
				a.releaseQuota(userID)
			}
		}()

		sw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(sw, r)

		status := "success"
		if sw.status >= 400 {
			status = "failed"
		}
		provider := "openai"
		if a.Cfg.AIProvider != "" {
			provider = a.Cfg.AIProvider
		}
		modelID := a.Cfg.AIModelID
		// 先落 usage 再释放预留，缩小「检查配额 → 记录用量」间的竞态窗口。
		_ = a.Store.RecordUsage(userID, provider, modelID, requestKindFromPath(r.URL.Path), status, exempt, 0, 0)
	})
}

// reserveQuota 尝试为一次 AI 请求预留配额，成功返回 true，超限返回 false。
func (a *App) reserveQuota(userID string) bool {
	a.quotaMu.Lock()
	defer a.quotaMu.Unlock()
	used, err := a.Store.TodayUsage(userID)
	if err != nil {
		// 配额读取失败时不阻断（沿用旧行为），但也不预留
		return true
	}
	if used+a.quotaPending[userID] >= a.dailyQuota() {
		return false
	}
	a.quotaPending[userID]++
	return true
}

// releaseQuota 释放一次已预留的配额。
func (a *App) releaseQuota(userID string) {
	a.quotaMu.Lock()
	defer a.quotaMu.Unlock()
	if n := a.quotaPending[userID]; n > 1 {
		a.quotaPending[userID] = n - 1
	} else {
		delete(a.quotaPending, userID)
	}
}

// requestKindFromPath 按接口路径推断用量来源，供 ai_usage 记录。
func requestKindFromPath(p string) string {
	switch {
	case p == "/api/chat":
		return "chat"
	case p == "/api/v1/generate":
		return "generate"
	case p == "/api/generate-tasks":
		return "task"
	default:
		return "chat"
	}
}

// requestExempt 判断该请求是否豁免配额。
func (a *App) requestExempt(r *http.Request, user *db.User) bool {
	if a.Cfg.AccessPassword != "" && r.Header.Get("X-Access-Password") == a.Cfg.AccessPassword {
		return true
	}
	if user != nil {
		if cfg := a.Store.UserLlmConfig(user.ID); cfg != nil && cfg.APIKey != "" {
			// 仅当用户配置了与工作区默认不同的 baseUrl（真 BYOK）才豁免；
			// 只填假 apiKey 复用工作区默认端点的请求仍需消耗工作区配额。
			if cfg.BaseURL != "" && a.workspaceBaseURL() != normalizeBaseURL(cfg.BaseURL) {
				return true
			}
		}
	}
	return false
}

// workspaceBaseURL 返回工作区默认 LLM 端点（含工作区级 llm.config 覆盖）。
func (a *App) workspaceBaseURL() string {
	base := ai.Defaults(a.Cfg.AIProvider, a.Cfg.AIBaseURL, a.Cfg.AIAPIKey, a.Cfg.AIModelID)
	if cfg := a.Store.WorkspaceLlmConfig(); cfg != nil && cfg.BaseURL != "" {
		base = base.ApplyConfig(&ai.LlmConfig{Provider: cfg.Provider, BaseURL: cfg.BaseURL, APIKey: cfg.APIKey, ModelID: cfg.ModelID})
	}
	return normalizeBaseURL(base.BaseURL)
}

// normalizeBaseURL 去掉 baseURL 尾部斜杠与 /chat/completions 后缀，便于比较。
func normalizeBaseURL(raw string) string {
	return strings.TrimSuffix(strings.TrimSuffix(strings.TrimSpace(raw), "/"), "/chat/completions")
}

// statusWriter 捕获响应码，供 aiUsage 记录 status。
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (sw *statusWriter) WriteHeader(code int) {
	sw.status = code
	sw.ResponseWriter.WriteHeader(code)
}

func (sw *statusWriter) Write(b []byte) (int, error) {
	if sw.status == 0 {
		sw.status = http.StatusOK
	}
	return sw.ResponseWriter.Write(b)
}

// Flush 透传 SSE 流式刷新，保证 statusWriter 包裹下的流式响应及时 flush。
func (sw *statusWriter) Flush() {
	if f, ok := sw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}