package server

import (
	"net/http"

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
		// 先落 usage 再释放预留，缩小「检查配额 → 记录用量」间的竞态窗口。
		_ = a.Store.RecordUsage(userID, provider, status, exempt)

		if reserved == 1 {
			a.releaseQuota(userID)
		}
	})
}

// quotaUsedNow 返回某用户今日已用配额（含进行中的预留）。
func (a *App) quotaUsedNow(userID string) (int, error) {
	a.quotaMu.Lock()
	defer a.quotaMu.Unlock()
	used, err := a.Store.TodayUsage(userID)
	if err != nil {
		return 0, err
	}
	return used + a.quotaPending[userID], nil
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

// requestExempt 判断该请求是否豁免配额。
func (a *App) requestExempt(r *http.Request, user *db.User) bool {
	if a.Cfg.AccessPassword != "" && r.Header.Get("X-Access-Password") == a.Cfg.AccessPassword {
		return true
	}
	if user != nil {
		if cfg := a.Store.UserLlmConfig(user.ID); cfg != nil && cfg.APIKey != "" {
			return true
		}
	}
	return false
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