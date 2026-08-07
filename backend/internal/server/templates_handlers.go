package server

import (
	"net/http"
	"strings"

	"ai-draw-nexus/internal/db"

	"github.com/google/uuid"
)

// handleListTemplates GET /api/templates
// 返回当前用户可见模板（system + workspace + 本人 private）。
func (a *App) handleListTemplates(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	engine := r.URL.Query().Get("engine_type")
	typ := r.URL.Query().Get("type")
	list, err := a.Store.ListVisibleTemplates(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	out := make([]db.Template, 0, len(list))
	for _, t := range list {
		if engine != "" && t.EngineType != engine {
			continue
		}
		if typ != "" && t.Type != typ {
			continue
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": out})
}

type templateReq struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Type        string `json:"type"`
	EngineType  string `json:"engine_type"`
	Scope       string `json:"scope"`
	Content     string `json:"content"`
}

// handleCreateTemplate POST /api/templates
func (a *App) handleCreateTemplate(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	var body templateReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	body.Code = strings.TrimSpace(body.Code)
	body.Name = strings.TrimSpace(body.Name)
	if body.Code == "" || body.Name == "" || body.Content == "" {
		writeError(w, http.StatusBadRequest, "编号、名称、内容不能为空")
		return
	}
	if body.Type == "" {
		body.Type = "prompt"
	}
	if body.EngineType == "" {
		body.EngineType = "drawio"
	}
	switch body.Type {
	case "prompt", "skeleton":
	default:
		writeError(w, http.StatusBadRequest, "无效的模板类型")
		return
	}
	switch body.EngineType {
	case "drawio", "excalidraw", "mermaid":
	default:
		writeError(w, http.StatusBadRequest, "无效的引擎类型")
		return
	}
	scope := body.Scope
	switch scope {
	case "", "private":
		scope = "private"
	case "workspace":
		if !a.isAdmin(r) {
			writeError(w, http.StatusForbidden, "仅管理员可创建工作区模板")
			return
		}
	case "system":
		writeError(w, http.StatusForbidden, "系统模板不可由用户创建")
		return
	default:
		writeError(w, http.StatusBadRequest, "无效的模板范围")
		return
	}
	if ok, _ := a.Store.CodeExists(body.Code); ok {
		writeError(w, http.StatusConflict, "模板编号已存在，请换一个")
		return
	}
	t := &db.Template{
		ID: uuid.NewString(), Code: body.Code, Name: body.Name,
		Description: body.Description, Type: body.Type, EngineType: body.EngineType,
		Scope: scope, Content: body.Content, OwnerID: db.NewNullString(user.ID),
	}
	if err := a.Store.CreateTemplate(t); err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

// handleUpdateTemplate PUT /api/templates/{id}
func (a *App) handleUpdateTemplate(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.PathValue("id")
	var body templateReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	t, err := a.Store.GetTemplateByID(user.ID, id)
	if err != nil || t == nil {
		writeError(w, http.StatusNotFound, "模板不存在或无权访问")
		return
	}
	if t.Scope == "system" {
		writeError(w, http.StatusForbidden, "系统模板不可修改")
		return
	}
	if t.Scope == "workspace" && !a.isAdmin(r) {
		writeError(w, http.StatusForbidden, "仅管理员可修改工作区模板")
		return
	}
	if t.Scope == "private" && t.OwnerID.Str() != user.ID {
		writeError(w, http.StatusNotFound, "模板不存在或无权访问")
		return
	}
	ok, err := a.Store.UpdateTemplate(id, user.ID,
		strPtr(body.Name), strPtr(body.Description), strPtr(body.Type), strPtr(body.Content))
	if err != nil || !ok {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	updated, _ := a.Store.GetTemplateByID(user.ID, id)
	writeJSON(w, http.StatusOK, updated)
}

// handleDeleteTemplate DELETE /api/templates/{id}
func (a *App) handleDeleteTemplate(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.PathValue("id")
	t, err := a.Store.GetTemplateByID(user.ID, id)
	if err != nil || t == nil {
		writeError(w, http.StatusNotFound, "模板不存在或无权访问")
		return
	}
	if t.Scope == "system" {
		writeError(w, http.StatusForbidden, "系统模板不可删除")
		return
	}
	if t.Scope == "workspace" && !a.isAdmin(r) {
		writeError(w, http.StatusForbidden, "仅管理员可删除工作区模板")
		return
	}
	if t.Scope == "private" && t.OwnerID.Str() != user.ID {
		writeError(w, http.StatusNotFound, "模板不存在或无权访问")
		return
	}
	ok, err := a.Store.DeleteTemplate(user.ID, id)
	if err != nil || !ok {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// isAdmin 判断当前请求用户是否为 admin。
func (a *App) isAdmin(r *http.Request) bool {
	u := a.loadUserFromRequest(r)
	return u != nil && u.Role == "admin"
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
