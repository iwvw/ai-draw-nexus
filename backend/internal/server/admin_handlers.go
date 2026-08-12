package server

import (
	"net/http"
	"strconv"
	"strings"

	"ai-draw-nexus/internal/auth"

	"encoding/json"
)

// adminCreateUserReq 管理员创建用户请求体。
type adminCreateUserReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
	Status   string `json:"status"`
}

// adminUpdateUserReq 管理员更新用户请求体（字段可选）。
type adminUpdateUserReq struct {
	Name   *string `json:"name"`
	Email  *string `json:"email"`
	Role   *string `json:"role"`
	Status *string `json:"status"`
}

func listLimit(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return fallback
	}
	if n > 200 {
		return 200
	}
	return n
}

// handleAdminStats GET /api/admin/stats
func (a *App) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	st, err := a.Store.AdminStats()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// handleAdminAITrend GET /api/admin/stats/ai-trend?days=
func (a *App) handleAdminAITrend(w http.ResponseWriter, r *http.Request) {
	days := 7
	if raw := r.URL.Query().Get("days"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			days = n
		}
	}
	if days < 1 {
		days = 1
	}
	if days > 90 {
		days = 90
	}
	rows, err := a.Store.AITrend(days)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

// handleAdminListUsers GET /api/admin/users?limit=
func (a *App) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	limit := listLimit(r.URL.Query().Get("limit"), 100)
	users, err := a.Store.ListAdminUsers(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, users)
}

// handleAdminCreateUser POST /api/admin/users
func (a *App) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	actor := ctxUser(r)
	var body adminCreateUserReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	username := strings.TrimSpace(strings.ToLower(body.Username))
	if len(username) < 3 || len(username) > 50 {
		writeError(w, http.StatusBadRequest, "用户名至少需要 3 个字符")
		return
	}
	if len(body.Password) < 6 || len(body.Password) > 200 {
		writeError(w, http.StatusBadRequest, "密码至少需要 6 个字符")
		return
	}
	role := body.Role
	if role != "admin" && role != "member" {
		role = "member"
	}
	status := body.Status
	if status != "active" && status != "suspended" {
		status = "active"
	}
	if existing, _ := a.Store.GetUserByLoginID(username); existing != nil {
		writeError(w, http.StatusConflict, "用户已存在")
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	created, err := a.Store.AdminCreateUser(username, hash, role, status)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	a.Store.RecordAudit(actor.ID, "admin.user.create", "user", created["id"],
		auditJSON(map[string]any{"role": role, "status": status}))
	writeJSON(w, http.StatusCreated, created)
}

// handleAdminUpdateUser PATCH /api/admin/users/:id
func (a *App) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	actor := ctxUser(r)
	targetID := r.PathValue("id")
	var body adminUpdateUserReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	if body.Name == nil && body.Email == nil && body.Role == nil && body.Status == nil {
		writeError(w, http.StatusBadRequest, "没有可更新的字段")
		return
	}
	targetRole, targetStatus, exists, err := a.Store.GetUserRoleStatus(targetID)
	if err != nil || !exists {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if body.Role != nil || body.Status != nil {
		newRole := targetRole
		if body.Role != nil {
			newRole = *body.Role
		}
		newStatus := targetStatus
		if body.Status != nil {
			newStatus = *body.Status
		}
		wouldRemove := targetRole == "admin" && targetStatus == "active" &&
			(newRole == "member" || newStatus == "suspended")
		if wouldRemove {
			admins, _ := a.Store.AdminCount()
			if admins <= 1 {
				writeError(w, http.StatusBadRequest, "不能移除最后一个启用的管理员")
				return
			}
		}
		if targetID == actor.ID && body.Status != nil && *body.Status == "suspended" {
			writeError(w, http.StatusBadRequest, "管理员不能停用自己的账号")
			return
		}
	}
	var name, email, role, status *string
	if body.Name != nil {
		s := strings.TrimSpace(*body.Name)
		name = &s
	}
	if body.Email != nil {
		s := normalizeBodyPtr(*body.Email)
		email = &s
	}
	if body.Role != nil {
		s := *body.Role
		if s != "admin" && s != "member" {
			writeError(w, http.StatusBadRequest, "无效的角色")
			return
		}
		role = &s
	}
	if body.Status != nil {
		s := *body.Status
		if s != "active" && s != "suspended" {
			writeError(w, http.StatusBadRequest, "无效的状态")
			return
		}
		status = &s
	}
	if err := a.Store.AdminUpdateUser(targetID, name, email, role, status); err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	a.Store.RecordAudit(actor.ID, "admin.user.update", "user", targetID, "{}")
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// handleAdminListProjects GET /api/admin/projects?limit=
func (a *App) handleAdminListProjects(w http.ResponseWriter, r *http.Request) {
	limit := listLimit(r.URL.Query().Get("limit"), 100)
	projects, err := a.Store.ListAdminProjects(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

// handleAdminListSettings GET /api/admin/settings
func (a *App) handleAdminListSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := a.Store.ListSettings()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// adminSettingsKeys 管理员可修改的 settings 白名单（防误写任意 key 破坏配置结构）。
var adminSettingsKeys = map[string]bool{
	"ai.provider_defaults":        true,
	"ai.daily_quota":              true,
	"security.allow_registration": true,
	"security.allow_public_access": true,
}

// handleAdminUpdateSetting PUT /api/admin/settings/:key
func (a *App) handleAdminUpdateSetting(w http.ResponseWriter, r *http.Request) {
	actor := ctxUser(r)
	key := r.PathValue("key")
	if !adminSettingsKeys[key] {
		writeError(w, http.StatusBadRequest, "不允许修改该设置项")
		return
	}
	var body struct {
		Value any `json:"value"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	value := stringifySetting(body.Value)
	if err := a.Store.UpsertSettingBy(key, value, actor.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	a.Store.RecordAudit(actor.ID, "admin.setting.update", "setting", key, "{}")
	writeJSON(w, http.StatusOK, map[string]string{"key": key, "value": value})
}

// handleAdminListUsage GET /api/admin/usage?limit=
func (a *App) handleAdminListUsage(w http.ResponseWriter, r *http.Request) {
	limit := listLimit(r.URL.Query().Get("limit"), 100)
	usage, err := a.Store.ListAdminUsage(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, usage)
}

// handleAdminListAudit GET /api/admin/audit?limit=
func (a *App) handleAdminListAudit(w http.ResponseWriter, r *http.Request) {
	limit := listLimit(r.URL.Query().Get("limit"), 100)
	audit, err := a.Store.ListAdminAudit(limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, audit)
}

// normalizeBodyPtr 规范化 email（小写去空白），空转 ""。
func normalizeBodyPtr(email string) string {
	return strings.TrimSpace(strings.ToLower(email))
}

// stringifySetting 字符串保持，否则 JSON 编码。
func stringifySetting(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	b, _ := json.Marshal(v)
	return string(b)
}