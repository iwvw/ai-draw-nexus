package server

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"ai-draw-nexus/internal/auth"

	"github.com/google/uuid"
)

type registerReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginReq struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// registrationAllowed 判断是否允许注册。
func (a *App) registrationAllowed() bool {
	if a.Cfg.DisableRegistr {
		return false
	}
	v, _, _ := a.Store.Setting("security.allow_registration")
	return v != "false"
}

func setAuthCookieHeader(w http.ResponseWriter, token string, secure bool) {
	w.Header().Add("Set-Cookie", auth.SetAuthCookie(token, secure))
}

func clearAuthCookieHeader(w http.ResponseWriter) {
	w.Header().Add("Set-Cookie", auth.ClearAuthCookie())
}

// handleRegister POST /api/auth/register
func (a *App) handleRegister(w http.ResponseWriter, r *http.Request) {
	var body registerReq
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
	count, err := a.Store.UserCount()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	if count > 0 && !a.registrationAllowed() {
		writeError(w, http.StatusForbidden, "当前工作区已关闭注册")
		return
	}
	existing, _ := a.Store.GetUserByLoginID(username)
	if existing != nil {
		writeError(w, http.StatusConflict, "用户名已存在")
		return
	}
	role := "member"
	if count == 0 {
		role = "admin"
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	user, err := a.Store.CreateUser(username, "", hash, username, role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	a.Store.RecordAudit(user.ID, "auth.register", "user", user.ID, `{"role":"`+role+`"}`)
	token, err := a.JWT.SignWithSession(auth.Payload{UserId: user.ID, Username: username, Name: user.Name, Role: user.Role}, 0)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	setAuthCookieHeader(w, token, a.Cfg.IsProduction())
	writeJSON(w, http.StatusCreated, map[string]any{
		"user":  map[string]string{"id": user.ID, "username": username, "name": user.Name, "role": user.Role},
		"token": token,
	})
}

// handleLogin POST /api/auth/login
func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body loginReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请输入用户名或密码")
		return
	}
	username := body.Username
	if len(username) < 1 || len(username) > 120 {
		writeError(w, http.StatusBadRequest, "请输入用户名或邮箱")
		return
	}
	if len(body.Password) < 1 || len(body.Password) > 200 {
		writeError(w, http.StatusBadRequest, "请输入密码")
		return
	}
	login := strings.TrimSpace(strings.ToLower(username))
	user, err := a.Store.GetUserByLoginID(login)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	if user == nil {
		writeError(w, http.StatusUnauthorized, "用户名或密码不正确")
		return
	}
	if user.Status != "active" {
		writeError(w, http.StatusForbidden, "账号已停用")
		return
	}
	if !auth.VerifyPassword(body.Password, user.Password) {
		writeError(w, http.StatusUnauthorized, "用户名或密码不正确")
		return
	}
	if auth.IsLegacyPasswordHash(user.Password) {
		newHash, herr := auth.HashPassword(body.Password)
		if herr == nil {
			_ = a.Store.UpdateUserPassword(user.ID, newHash)
		}
	}
	_ = a.Store.TouchLastLogin(user.ID)
	a.Store.RecordAudit(user.ID, "auth.login", "user", user.ID, "")
	token, terr := a.JWT.SignWithSession(auth.Payload{UserId: user.ID, Username: user.Username, Name: user.Name, Role: user.Role}, 0)
	if terr != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	setAuthCookieHeader(w, token, a.Cfg.IsProduction())
	emailVal := any(nil)
	if user.Email.Valid {
		emailVal = user.Email.String
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id": user.ID, "username": user.Username, "email": emailVal,
			"name": user.Name, "role": user.Role,
		},
		"token": token,
	})
}

// handleLogout POST /api/auth/logout
func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	clearAuthCookieHeader(w)
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// handleStatus GET /api/auth/status
func (a *App) handleStatus(w http.ResponseWriter, r *http.Request) {
	count, _ := a.Store.UserCount()
	allowPublic, _, _ := a.Store.Setting("security.allow_public_access")
	writeJSON(w, http.StatusOK, map[string]any{
		"initialized":       count > 0,
		"allowPublic":       allowPublic != "false",
		"allowRegistration": a.registrationAllowed(),
	})
}

// handleMe GET /api/auth/me
func (a *App) handleMe(w http.ResponseWriter, r *http.Request) {
	u := ctxUser(r)
	if u == nil {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}
	token := auth.ReadAuthCookie(r.Header.Get("Cookie"))
	if token == "" {
		h := r.Header.Get("Authorization")
		if len(h) > len("Bearer ") && h[:len("Bearer ")] == "Bearer " {
			token = h[len("Bearer "):]
		}
	}
	emailVal := any(nil)
	if u.Email.Valid {
		emailVal = u.Email.String
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user": map[string]any{
			"id": u.ID, "username": u.Username, "email": emailVal,
			"name": u.Name, "role": u.Role, "status": u.Status,
		},
		"token": token,
	})
}

// apiTokenReq 生成 API token 的请求体（字段可选）。
type apiTokenReq struct {
	ExpiresInDays *int `json:"expires_in_days"`
	Name          string `json:"name"`
}

// handleCreateAPIToken POST /api/auth/api-token
func (a *App) handleCreateAPIToken(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}
	var body apiTokenReq
	_ = decodeBody(r, &body)
	days := 0
	if body.ExpiresInDays != nil && *body.ExpiresInDays > 0 {
		d := *body.ExpiresInDays
		if d > 3650 {
			d = 3650
		}
		days = int(d)
	}
	name := body.Name
	jti := uuid.NewString()
	p := auth.Payload{UserId: user.ID, Username: user.Username, Name: user.Name, Role: user.Role, Jti: jti}
	var token string
	var err error
	var expiresAt sql.NullString
	if days > 0 {
		token, err = a.JWT.SignWithSession(p, int64(days*24*60*60))
		expiresAt = sql.NullString{String: time.Now().Add(time.Duration(days) * 24 * time.Hour).UTC().Format(time.RFC3339), Valid: true}
	} else {
		token, err = a.JWT.SignWithSession(p, 0)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	tokenID, err := a.Store.StoreAPIToken(user.ID, jti, sha256Hex(token), name, expiresAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	a.Store.RecordAudit(user.ID, "auth.api_token", "user", user.ID,
		`{"tokenId":"`+tokenID+`","expiresInDays":`+itoa(days)+`}`)
	expVal := any(nil)
	if expiresAt.Valid {
		expVal = expiresAt.String
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token, "token_id": tokenID,
		"expires_in_days": days, "expires_at": expVal,
	})
}

// handleListAPITokens GET /api/auth/api-tokens
func (a *App) handleListAPITokens(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	tokens, err := a.Store.ListAPITokens(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": tokens})
}

// handleRevokeAPIToken DELETE /api/auth/api-tokens/:id
func (a *App) handleRevokeAPIToken(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	idStr := r.PathValue("id")
	if idStr == "" {
		writeError(w, http.StatusBadRequest, "缺少令牌 ID")
		return
	}
	ok, err := a.Store.RevokeAPIToken(user.ID, idStr)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "令牌不存在或已撤销")
		return
	}
	a.Store.RecordAudit(user.ID, "auth.api_token_revoke", "token", idStr, "")
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func itoa(n int) string { return strconv.Itoa(n) }