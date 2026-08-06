package server

import (
	"net/http"

	"ai-draw-nexus/internal/db"
)

// aiUsage 中间件（仅 /api/chat POST）：
// 计算并可能拦截配额、写 ai_usage 记录。豁免条件：
// 1. X-Access-Password == ACCESS_PASSWORD（配置在 cfg）
// 2. 用户已保存 llm.config 且带 apiKey
// 3. 请求体 llmConfig.apiKey 存在（但豁免以服务端保存为准）
//
// 由于流程需在进入 handler 前判豁免/计数、在 handler 后记 usage，这里在中间件内
// 先解析身份→判定豁免→配额检查，再调 next，完成后写日志。
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

		if userID != "" && !exempt {
			used, err := a.Store.TodayUsage(userID)
			if err == nil && used >= a.dailyQuota() {
				writeError(w, http.StatusTooManyRequests, "今日 AI 配额已用完")
				return
			}
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
		_ = a.Store.RecordUsage(userID, provider, status, exempt)
	})
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