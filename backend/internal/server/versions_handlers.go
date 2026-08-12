package server

import (
	"net/http"
	"time"
)

type createVersionReq struct {
	ProjectID     string `json:"project_id"`
	Content       string `json:"content"`
	ChangeSummary string `json:"change_summary"`
}

type updateVersionReq struct {
	Content string `json:"content"`
}

// handleListVersions GET /api/versions/?project_id=
func (a *App) handleListVersions(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	pid := r.URL.Query().Get("project_id")
	if pid == "" {
		writeError(w, http.StatusBadRequest, "缺少项目 ID")
		return
	}
	p, err := a.Store.GetUserProject(user.ID, pid)
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	versions, err := a.Store.ListVersions(pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, versions)
}

// handleCreateVersion POST /api/versions/
func (a *App) handleCreateVersion(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	var body createVersionReq
	if err := decodeBodyLimit(r, &body, maxLargeBodyBytes); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	if body.ProjectID == "" || body.Content == "" {
		writeError(w, http.StatusBadRequest, "缺少 project_id 或 content")
		return
	}
	p, err := a.Store.GetUserProject(user.ID, body.ProjectID)
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	id, err := a.Store.CreateVersion(body.ProjectID, user.ID, body.Content, body.ChangeSummary)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	_ = a.Store.TouchProject(body.ProjectID)
	writeJSON(w, http.StatusCreated, map[string]string{
		"id": id, "project_id": body.ProjectID,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

// handleGetVersion GET /api/versions/detail?id=
func (a *App) handleGetVersion(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "缺少版本 ID")
		return
	}
	v, err := a.Store.GetVersion(id)
	if err != nil || v == nil {
		writeError(w, http.StatusNotFound, "版本不存在或无权访问")
		return
	}
	// 校验版本属于用户本人项目
	p, _ := a.Store.GetUserProject(user.ID, v.ProjectID)
	if p == nil {
		writeError(w, http.StatusNotFound, "版本不存在或无权访问")
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// handleUpdateVersion PUT /api/versions/detail?id=
func (a *App) handleUpdateVersion(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "缺少版本 ID")
		return
	}
	var body updateVersionReq
	if err := decodeBody(r, &body); err != nil || body.Content == "" {
		writeError(w, http.StatusBadRequest, "缺少 content")
		return
	}
	v, _ := a.Store.GetVersion(id)
	if v == nil {
		writeError(w, http.StatusNotFound, "版本不存在或无权访问")
		return
	}
	if p, _ := a.Store.GetUserProject(user.ID, v.ProjectID); p == nil {
		writeError(w, http.StatusNotFound, "版本不存在或无权访问")
		return
	}
	ok, err := a.Store.UpdateVersionContent(id, body.Content)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "版本不存在或无权访问")
		return
	}
	_ = a.Store.TouchProject(v.ProjectID)
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// handleDeleteVersion DELETE /api/versions/detail?id=
func (a *App) handleDeleteVersion(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "缺少版本 ID")
		return
	}
	v, err := a.Store.GetVersion(id)
	if v == nil || err != nil {
		writeError(w, http.StatusNotFound, "版本不存在或无权访问")
		return
	}
	if p, _ := a.Store.GetUserProject(user.ID, v.ProjectID); p == nil {
		writeError(w, http.StatusNotFound, "版本不存在或无权访问")
		return
	}
	ok, err := a.Store.DeleteVersion(id)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "版本不存在或无权访问")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}