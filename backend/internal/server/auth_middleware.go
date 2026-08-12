package server

import (
	"net/http"
	"sync"

	"ai-draw-nexus/internal/auth"
	"ai-draw-nexus/internal/config"
	"ai-draw-nexus/internal/db"
	"ai-draw-nexus/internal/mcp"
)

// App 持有 server 所需的依赖（DB、JWT、配置）。
type App struct {
	Store  *db.Store
	JWT    *auth.JWTService
	Cfg    *config.Config
	hub    *collabHub
	Mcp    *mcp.Handler
	taskQ  *taskQueue

	sseMu      sync.Mutex
	sseStreams map[string]chan []byte

	quotaMu      sync.Mutex
	quotaPending map[string]int
}

// verifyAuthPayload 从 cookie 或 Bearer 头解析已验证载荷，并检查 jti 有效性。
func (a *App) verifyAuthPayload(r *http.Request) *auth.Payload {
	token := auth.ReadAuthCookie(r.Header.Get("Cookie"))
	if token == "" {
		h := r.Header.Get("Authorization")
		if len(h) > len("Bearer ") && h[:len("Bearer ")] == "Bearer " {
			token = h[len("Bearer "):]
		}
	}
	if token == "" {
		return nil
	}
	p, err := a.JWT.Verify(token)
	if err != nil {
		return nil
	}
	if p.Jti != "" && !a.Store.IsAPITokenValid(p.Jti) {
		return nil
	}
	return p
}

// loadUserFromRequest 解析并回查用户（含状态校验），失败返回 nil。
func (a *App) loadUserFromRequest(r *http.Request) *db.User {
	p := a.verifyAuthPayload(r)
	if p == nil {
		return nil
	}
	u, err := a.Store.GetUserByID(p.UserId)
	if err != nil || u == nil || u.Status != "active" {
		return nil
	}
	return u
}

// requireAuth 校验登录态。
func (a *App) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := a.loadUserFromRequest(r)
		if u == nil {
			writeError(w, http.StatusUnauthorized, "请先登录")
			return
		}
		next.ServeHTTP(w, withUser(r, u))
	})
}

// requireLoginIfLocked 非公开工作区强制登录。
func (a *App) requireLoginIfLocked(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		allow, _, _ := a.Store.Setting("security.allow_public_access")
		if allow != "false" {
			next.ServeHTTP(w, r)
			return
		}
		u := a.loadUserFromRequest(r)
		if u == nil {
			writeError(w, http.StatusUnauthorized, "请先登录")
			return
		}
		next.ServeHTTP(w, withUser(r, u))
	})
}

// requireAdmin 校验当前用户为 admin。
func (a *App) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := ctxUser(r)
		if u == nil {
			writeError(w, http.StatusUnauthorized, "请先登录")
			return
		}
		if u.Role != "admin" {
			writeError(w, http.StatusForbidden, "需要管理员权限")
			return
		}
		next.ServeHTTP(w, r)
	})
}