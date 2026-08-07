package server

import (
	"net/http"
	"strings"

	"ai-draw-nexus/internal/ai"
	"ai-draw-nexus/internal/db"
	"ai-draw-nexus/internal/gen"

	"github.com/google/uuid"
)

// v1Project 响应结构（REST 版 /api/v1）。
type v1Project struct {
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	Title      string `json:"title"`
	EngineType string `json:"engine_type"`
	Thumbnail  string `json:"thumbnail"`
	Visibility string `json:"visibility"`
	Status     string `json:"status"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

// v1ProjectDetail 含内容信息。
type v1ProjectDetail struct {
	v1Project
	Content           *string `json:"content"`
	VersionID         *string `json:"version_id"`
	VersionUpdatedAt  *string `json:"version_updated_at"`
}

// handleV1ListProjects GET /api/v1/projects
func (a *App) handleV1ListProjects(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	projects, err := a.Store.ListUserProjects(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	out := make([]v1Project, 0, len(projects))
	for _, p := range projects {
		out = append(out, v1Project{
			ID: p.ID, UserID: p.UserID, Title: p.Title, EngineType: p.EngineType,
			Thumbnail: p.Thumbnail, Visibility: p.Visibility, Status: p.Status,
			CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": out})
}

// handleV1CreateProject POST /api/v1/projects
func (a *App) handleV1CreateProject(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	var body createProjectReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请输入项目名称")
		return
	}
	if body.Title == "" || len(body.Title) > 120 {
		writeError(w, http.StatusBadRequest, "请输入项目名称")
		return
	}
	switch body.EngineType {
	case "drawio", "excalidraw", "mermaid":
	default:
		writeError(w, http.StatusBadRequest, "无效的引擎类型")
		return
	}
	id := uuid.NewString()
	if err := a.Store.CreateProject(id, user.ID, body.Title, body.EngineType, ""); err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	a.Store.RecordAudit(user.ID, "project.create", "project", id,
		`{"source":"api.v1","engineType":"`+body.EngineType+`"}`)
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{
		"id": id, "title": body.Title, "engine_type": body.EngineType,
		"content": nil, "version_id": nil,
	}})
}

// handleV1GetProject GET /api/v1/projects/:id
func (a *App) handleV1GetProject(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.PathValue("id")
	p, err := a.Store.GetUserProject(user.ID, id)
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	v, _ := a.Store.LatestVersionOfProject(id)
	writeJSON(w, http.StatusOK, map[string]any{"data": v1DetailFrom(p, v)})
}

// handleV1PatchProject PATCH /api/v1/projects/:id
func (a *App) handleV1PatchProject(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.PathValue("id")
	p, err := a.Store.GetUserProject(user.ID, id)
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if err := decodeBody(r, &body); err != nil || body.Title == "" {
		writeError(w, http.StatusBadRequest, "请输入项目名称")
		return
	}
	ok, _ := a.Store.UpdateProjectMeta(id, user.ID, &body.Title, nil)
	if !ok {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]string{"id": id, "title": body.Title}})
}

// handleV1DeleteProject DELETE /api/v1/projects/:id
func (a *App) handleV1DeleteProject(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.PathValue("id")
	if p, _ := a.Store.GetUserProject(user.ID, id); p == nil {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	_, _ = a.Store.SoftDeleteProject(user.ID, id)
	a.Store.RecordAudit(user.ID, "project.delete", "project", id, `{"source":"api.v1"}`)
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]bool{"success": true}})
}

// handleV1GetContent GET /api/v1/projects/:id/content
func (a *App) handleV1GetContent(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.PathValue("id")
	p, err := a.Store.GetUserProject(user.ID, id)
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	v, _ := a.Store.LatestVersionOfProject(id)
	content := ""
	if v != nil {
		content = v.Content
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"project_id":         p.ID,
		"engine_type":        p.EngineType,
		"content":            content,
		"version_id":         nullableStrID(v),
		"version_updated_at": nullableStrTS(v),
	}})
}

// handleV1PutContent PUT /api/v1/projects/:id/content
func (a *App) handleV1PutContent(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.PathValue("id")
	p, err := a.Store.GetUserProject(user.ID, id)
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	var body struct {
		Content       string `json:"content"`
		ChangeSummary string `json:"change_summary"`
	}
	if err := decodeBody(r, &body); err != nil || body.Content == "" {
		writeError(w, http.StatusBadRequest, "内容不能为空")
		return
	}
	versionID, err := a.Store.CreateVersion(p.ID, user.ID, body.Content, body.ChangeSummary)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	_ = a.Store.TouchProject(p.ID)
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]string{
		"version_id": versionID, "project_id": p.ID,
	}})
}

// handleV1ListVersions GET /api/v1/projects/:id/versions
func (a *App) handleV1ListVersions(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.PathValue("id")
	p, err := a.Store.GetUserProject(user.ID, id)
	if err != nil || p == nil {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	vs, err := a.Store.ListVersions(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": vs})
}

// handleV1GetVersion GET /api/v1/versions/:id
func (a *App) handleV1GetVersion(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.PathValue("id")
	v, err := a.Store.GetVersionOwnedByUser(id, user.ID)
	if err != nil || v == nil {
		writeError(w, http.StatusNotFound, "版本不存在或无权访问")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": v})
}

// handleV1Engines GET /api/v1/engines
func (a *App) handleV1Engines(w http.ResponseWriter, r *http.Request) {
	vals := []string{"drawio", "excalidraw", "mermaid"}
	out := make([]map[string]string, 0, 3)
	for _, v := range vals {
		out = append(out, map[string]string{"value": v, "label": v})
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": out})
}

// handleV1Generate POST /api/v1/generate
func (a *App) handleV1Generate(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	var body struct {
		Prompt         string `json:"prompt"`
		EngineType     string `json:"engine_type"`
		CurrentContent string `json:"current_content"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请输入提示词")
		return
	}
	if body.Prompt == "" {
		writeError(w, http.StatusBadRequest, "请输入提示词")
		return
	}
	if len(body.Prompt) > 50000 {
		writeError(w, http.StatusBadRequest, "提示词过长（超过 50000 字符），请精简后重试")
		return
	}
	engine := body.EngineType
	if engine == "" {
		engine = "drawio"
	}
	switch engine {
	case "drawio", "excalidraw", "mermaid":
	default:
		writeError(w, http.StatusBadRequest, "无效的引擎类型")
		return
	}
	env := a.resolveEnv(user, nil)
	messages := []ai.Message{
		{Role: "system", Content: gen.SystemPrompt(engine)},
		{Role: "user", Content: gen.UserContent(body.Prompt, body.CurrentContent)},
	}
	result, err := gen.Generate(r.Context(), messages, env, engine)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

// handleV1Upload POST /api/v1/files (multipart)
func (a *App) handleV1Upload(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "请以 multipart/form-data 上传文件")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少文件字段 file")
		return
	}
	defer file.Close()
	filename := header.Filename
	if filename == "" {
		filename = "unnamed"
	}
	if !importableExt(filename) {
		writeError(w, http.StatusUnsupportedMediaType,
			"不支持的文件类型："+filename+"。支持 .mmd/.mermaid/.excalidraw/.drawio/.xml/.json/.txt")
		return
	}
	if header.Size > 20<<20 {
		writeError(w, http.StatusRequestEntityTooLarge, "文件过大：最大支持 20MB")
		return
	}
	var sb strings.Builder
	buf := make([]byte, 32*1024)
	for {
		n, err := file.Read(buf)
		if n > 0 {
			sb.Write(buf[:n])
		}
		if err != nil {
			break
		}
	}
	content := sb.String()
	engine := inferEngine(content, filename)
	title := strings.TrimSuffix(filename, pathExt(filename))
	projectID := uuid.NewString()
	if err := a.Store.CreateProject(projectID, user.ID, title, engine, ""); err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	versionID, err := a.Store.CreateVersion(projectID, user.ID, content, "文件上传导入")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	a.Store.RecordAudit(user.ID, "project.import", "project", projectID,
		`{"source":"api.v1.upload","filename":"`+filename+`","engineType":"`+engine+`","bytes":`+strSize(header.Size)+`}`)
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{
		"project_id": projectID, "title": title, "engine_type": engine,
		"version_id": versionID, "bytes": header.Size,
	}})
}

// 辅助函数

func v1DetailFrom(p *db.Project, v *db.VersionDetail) v1ProjectDetail {
	return v1ProjectDetail{
		v1Project: v1Project{
			ID: p.ID, UserID: p.UserID, Title: p.Title, EngineType: p.EngineType,
			Thumbnail: p.Thumbnail, Visibility: p.Visibility, Status: p.Status,
			CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		},
		Content:          nullableStr(v),
		VersionID:        nullableStrID(v),
		VersionUpdatedAt: nullableStrTS(v),
	}
}

func nullableStr(v *db.VersionDetail) *string {
	if v == nil {
		return nil
	}
	s := v.Content
	return &s
}

func nullableStrID(v *db.VersionDetail) *string {
	if v == nil {
		return nil
	}
	s := v.ID
	return &s
}

func nullableStrTS(v *db.VersionDetail) *string {
	if v == nil {
		return nil
	}
	s := v.Timestamp
	return &s
}