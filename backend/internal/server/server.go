package server

import (
	"net/http"

	"ai-draw-nexus/internal/auth"
	"ai-draw-nexus/internal/config"
	"ai-draw-nexus/internal/db"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// New 构造 App。
func New(store *db.Store, jwt *auth.JWTService, cfg *config.Config) *App {
	return &App{Store: store, JWT: jwt, Cfg: cfg}
}

// Routes 组装整个 HTTP 路由。
func (a *App) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// 全应用级：锁定工作区时强制登录（放行公开访问）
	r.Use(a.requireLoginIfLocked)

	// 健康检查
	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	// 公开 AI 提示词（若 CMDS 使用）
	r.Get("/ai-prompt.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("请使用本系统的 REST API 进行绘图。"))
	})

	// ---- /api/auth ----
	r.Route("/api/auth", func(r chi.Router) {
		r.Post("/register", a.handleRegister)
		r.Post("/login", a.handleLogin)
		r.Post("/logout", a.handleLogout)
		r.Get("/status", a.handleStatus)
		r.Group(func(r chi.Router) {
			r.Use(a.requireAuth)
			r.Get("/me", a.handleMe)
			r.Post("/api-token", a.handleCreateAPIToken)
			r.Get("/api-tokens", a.handleListAPITokens)
			r.Delete("/api-tokens/{id}", a.handleRevokeAPIToken)
		})
	})

	// ---- 需要登录的业务路由 ----
	r.Group(func(r chi.Router) {
		r.Use(a.requireAuth)
		r.Route("/api/projects", func(r chi.Router) {
			r.Get("/", a.handleListProjects)
			r.Post("/", a.handleCreateProject)
			r.Get("/detail", a.handleGetProject)
			r.Put("/detail", a.handleUpdateProject)
			r.Delete("/detail", a.handleDeleteProject)
		})
		r.Route("/api/versions", func(r chi.Router) {
			r.Get("/", a.handleListVersions)
			r.Post("/", a.handleCreateVersion)
			r.Get("/detail", a.handleGetVersion)
			r.Put("/detail", a.handleUpdateVersion)
			r.Delete("/detail", a.handleDeleteVersion)
		})
		r.Get("/api/settings", a.handleGetSettings)
		r.Put("/api/settings", a.handlePutSettings)
		r.Delete("/api/settings/{key}", a.handleDeleteSetting)
		r.Get("/api/usage/today", a.handleGetUsageToday)
	})

	return r
}