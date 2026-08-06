package server

import (
	"net/http"

	"ai-draw-nexus/internal/ai"
	"ai-draw-nexus/internal/auth"
	"ai-draw-nexus/internal/config"
	"ai-draw-nexus/internal/db"
	"ai-draw-nexus/internal/mcp"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// New 构造 App。
func New(store *db.Store, jwt *auth.JWTService, cfg *config.Config) *App {
	app := &App{Store: store, JWT: jwt, Cfg: cfg, hub: newCollabHub()}
	app.Mcp = mcp.NewHandler(store, jwt, func(userID string) ai.EffectiveEnv {
		base := ai.Defaults(cfg.AIProvider, cfg.AIBaseURL, cfg.AIAPIKey, cfg.AIModelID)
		if ucfg := store.UserLlmConfig(userID); ucfg != nil && ucfg.APIKey != "" {
			return base.ApplyConfig(&ai.LlmConfig{Provider: ucfg.Provider, BaseURL: ucfg.BaseURL, APIKey: ucfg.APIKey, ModelID: ucfg.ModelID})
		}
		if wcfg := store.WorkspaceLlmConfig(); wcfg != nil && wcfg.APIKey != "" {
			return base.ApplyConfig(&ai.LlmConfig{Provider: wcfg.Provider, BaseURL: wcfg.BaseURL, APIKey: wcfg.APIKey, ModelID: wcfg.ModelID})
		}
		return base
	})
	return app
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
	// 公开 AI 提示词（Markdown，供外部 AI 工具读取接入说明）
	r.Get("/ai-prompt.txt", func(w http.ResponseWriter, r *http.Request) {
		proto := r.Header.Get("x-forwarded-proto")
		if proto == "" {
			proto = "http"
		}
		origin := ""
		if r.Host != "" {
			origin = proto + "://" + r.Host
		} else {
			origin = a.Cfg.PublicBaseURL
		}
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(aiSystemPrompt(origin)))
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
		// ---- /api/chat (AI) + /api/models ----
		r.With(a.aiUsage).Post("/api/chat", a.handleChat)
		r.Post("/api/models", a.handleModels)
		r.Post("/api/parse-url", a.handleParseURL)

		// ---- /api/chat/history ----
		r.Route("/api/chat/history", func(r chi.Router) {
			r.Get("/", a.handleListChat)
			r.Post("/", a.handleCreateChat)
			r.Put("/{id}", a.handleUpdateChat)
			r.Delete("/", a.handleClearChat)
		})

		// ---- /api/v1 (REST) ----
		r.Route("/api/v1", func(r chi.Router) {
			r.Get("/projects", a.handleV1ListProjects)
			r.Post("/projects", a.handleV1CreateProject)
			r.Get("/projects/{id}", a.handleV1GetProject)
			r.Patch("/projects/{id}", a.handleV1PatchProject)
			r.Delete("/projects/{id}", a.handleV1DeleteProject)
			r.Get("/projects/{id}/content", a.handleV1GetContent)
			r.Put("/projects/{id}/content", a.handleV1PutContent)
			r.Get("/projects/{id}/versions", a.handleV1ListVersions)
			r.Get("/versions/{id}", a.handleV1GetVersion)
			r.Get("/engines", a.handleV1Engines)
			r.Post("/generate", a.handleV1Generate)
			r.Post("/files", a.handleV1Upload)
		})

		r.Get("/api/settings", a.handleGetSettings)
		r.Put("/api/settings", a.handlePutSettings)
		r.Delete("/api/settings/{key}", a.handleDeleteSetting)
		r.Get("/api/usage/today", a.handleGetUsageToday)

		// ---- /api/admin (requireAdmin) ----
		r.Group(func(r chi.Router) {
			r.Use(a.requireAdmin)
			r.Get("/api/admin/stats", a.handleAdminStats)
			r.Get("/api/admin/stats/ai-trend", a.handleAdminAITrend)
			r.Get("/api/admin/users", a.handleAdminListUsers)
			r.Post("/api/admin/users", a.handleAdminCreateUser)
			r.Patch("/api/admin/users/{id}", a.handleAdminUpdateUser)
			r.Get("/api/admin/projects", a.handleAdminListProjects)
			r.Get("/api/admin/settings", a.handleAdminListSettings)
			r.Put("/api/admin/settings/{key}", a.handleAdminUpdateSetting)
			r.Get("/api/admin/usage", a.handleAdminListUsage)
			r.Get("/api/admin/audit", a.handleAdminListAudit)
		})
	})

	// ---- WebSocket 协作（无需登录鉴权，房间广播）----
	r.Get("/api/collab", a.handleCollab)

	// ---- MCP (JSON-RPC HTTP) ----
	r.HandleFunc("/mcp", a.handleMCP)

	return a.fileServer(r)
}