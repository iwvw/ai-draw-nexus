package server

import (
	"net/http"

	"github.com/google/uuid"
)

type createProjectReq struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	EngineType string `json:"engine_type"`
	Thumbnail  string `json:"thumbnail"`
}

type updateProjectReq struct {
	Title     *string `json:"title"`
	Thumbnail *string `json:"thumbnail"`
}

// handleListProjects GET /api/projects/
func (a *App) handleListProjects(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	projects, err := a.Store.ListUserProjects(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

// handleCreateProject POST /api/projects/
func (a *App) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	var body createProjectReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	if body.Title == "" || len(body.Title) > 120 {
		writeError(w, http.StatusBadRequest, "标题不能为空且不超过120字符")
		return
	}
	switch body.EngineType {
	case "drawio", "excalidraw", "mermaid":
	default:
		writeError(w, http.StatusBadRequest, "无效的引擎类型")
		return
	}
	id := body.ID
	if id == "" {
		id = uuid.NewString()
	} else {
		exists, _ := a.Store.ProjectExists(id)
		if exists {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "项目已存在", "id": id})
			return
		}
	}
	if err := a.Store.CreateProject(id, user.ID, body.Title, body.EngineType, body.Thumbnail); err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	a.Store.RecordAudit(user.ID, "project.create", "project", id, "")
	writeJSON(w, http.StatusCreated, map[string]string{
		"id": id, "title": body.Title, "engine_type": body.EngineType,
	})
}

// handleGetProject GET /api/projects/detail?id=
func (a *App) handleGetProject(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "缺少项目 ID")
		return
	}
	p, err := a.Store.GetUserProject(user.ID, id)
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "项目不存在")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// handleUpdateProject PUT /api/projects/detail?id=
func (a *App) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "缺少项目 ID")
		return
	}
	var body updateProjectReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	if body.Title == nil && body.Thumbnail == nil {
		writeError(w, http.StatusBadRequest, "缺少要更新的字段")
		return
	}
	ok, err := a.Store.UpdateProjectMeta(id, user.ID, body.Title, body.Thumbnail)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	a.Store.RecordAudit(user.ID, "project.update", "project", id, "")
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// handleDeleteProject DELETE /api/projects/detail?id=
func (a *App) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "缺少项目 ID")
		return
	}
	ok, err := a.Store.SoftDeleteProject(user.ID, id)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	a.Store.RecordAudit(user.ID, "project.delete", "project", id, "")
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}