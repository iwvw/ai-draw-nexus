// Package mcp 提供 MCP（JSON-RPC）HTTP 端点，暴露图表操作工具。
package mcp

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"ai-draw-nexus/internal/ai"
	"ai-draw-nexus/internal/auth"
	"ai-draw-nexus/internal/db"
	"ai-draw-nexus/internal/gen"

	"github.com/google/uuid"
)

// Actor 标识当前 MCP 调用者。
type Actor struct {
	ID       string
	Username string
	Role     string
	BaseURL  string
}

// Handler 实现 9 个 MCP 工具的业务逻辑。
type Handler struct {
	Store *db.Store
	JWT   *auth.JWTService
	// AIConfig getter：返回生效 AI 环境
	AIConfig func(actorID string) ai.EffectiveEnv
}

// NewHandler 构造 MCP Handler。
func NewHandler(store *db.Store, jwt *auth.JWTService, aiConfig func(string) ai.EffectiveEnv) *Handler {
	return &Handler{Store: store, JWT: jwt, AIConfig: aiConfig}
}

type toolCall struct {
	Name   string          `json:"name"`
	Inputs json.RawMessage `json:"input"`
}

// CallTool 分发单个工具调用，返回文本结果。
func (h *Handler) CallTool(ctx context.Context, actor *Actor, name string, input json.RawMessage) (string, error) {
	switch name {
	case "list_projects":
		return h.listProjects(actor)
	case "create_project":
		return h.createProject(actor, input)
	case "get_project":
		return h.getProject(actor, input)
	case "get_project_content":
		return h.getProjectContent(actor, input)
	case "update_project_content":
		return h.updateProjectContent(actor, input)
	case "list_versions":
		return h.listVersions(actor, input)
	case "get_version":
		return h.getVersion(actor, input)
	case "generate_diagram":
		return h.generateDiagram(ctx, actor, input)
	case "import_diagram":
		return h.importDiagram(actor, input)
	case "get_access_token":
		return h.getAccessToken(actor)
	default:
		return textResult(map[string]string{"error": "未知工具 " + name}), nil
	}
}

func textResult(v any) string {
	b, _ := json.MarshalIndent(v, "", "  ")
	return string(b)
}

func (h *Handler) listProjects(act *Actor) (string, error) {
	projects, err := h.Store.ListUserProjects(act.ID)
	if err != nil {
		return "", err
	}
	b, _ := json.MarshalIndent(projects, "", "  ")
	return string(b), nil
}

type createProjectIn struct {
	Title      string `json:"title"`
	EngineType string `json:"engine_type"`
}

func (h *Handler) createProject(act *Actor, input json.RawMessage) (string, error) {
	var in createProjectIn
	if err := json.Unmarshal(input, &in); err != nil {
		return "", err
	}
	id := uuid.NewString()
	if err := h.Store.CreateProject(id, act.ID, in.Title, in.EngineType, ""); err != nil {
		return "", err
	}
	return textResult(map[string]string{"id": id, "title": in.Title, "engine_type": in.EngineType}), nil
}

func (h *Handler) getProject(act *Actor, input json.RawMessage) (string, error) {
	var in struct{ ID string `json:"id"` }
	_ = json.Unmarshal(input, &in)
	p, err := h.Store.GetUserProject(act.ID, in.ID)
	if err != nil || p == nil {
		return "项目不存在或无权访问", nil
	}
	v, _ := h.Store.LatestVersionOfProject(in.ID)
	var content any
	if v != nil {
		content = v.Content
	}
	return textResult(map[string]any{
		"id": p.ID, "title": p.Title, "engine_type": p.EngineType,
		"visibility": p.Visibility, "status": p.Status,
		"created_at": p.CreatedAt, "updated_at": p.UpdatedAt, "content": content,
	}), nil
}

func (h *Handler) getProjectContent(act *Actor, input json.RawMessage) (string, error) {
	var in struct{ ID string `json:"id"` }
	_ = json.Unmarshal(input, &in)
	ok, _ := h.Store.UserOwnsProject(in.ID, act.ID)
	if !ok {
		return "项目不存在或无权访问", nil
	}
	v, _ := h.Store.LatestVersionOfProject(in.ID)
	if v == nil {
		return "该项目尚无内容", nil
	}
	return v.Content, nil
}

func (h *Handler) updateProjectContent(act *Actor, input json.RawMessage) (string, error) {
	var in struct {
		ID            string `json:"id"`
		Content       string `json:"content"`
		ChangeSummary string `json:"change_summary"`
	}
	_ = json.Unmarshal(input, &in)
	ok, _ := h.Store.UserOwnsProject(in.ID, act.ID)
	if !ok {
		return "项目不存在或无权访问", nil
	}
	versionID, err := h.Store.CreateVersion(in.ID, act.ID, in.Content, in.ChangeSummary)
	if err != nil {
		return "", err
	}
	_ = h.Store.TouchProject(in.ID)
	return textResult(map[string]string{"version_id": versionID, "project_id": in.ID}), nil
}

func (h *Handler) listVersions(act *Actor, input json.RawMessage) (string, error) {
	var in struct{ ID string `json:"id"` }
	_ = json.Unmarshal(input, &in)
	ok, _ := h.Store.UserOwnsProject(in.ID, act.ID)
	if !ok {
		return "项目不存在或无权访问", nil
	}
	vs, err := h.Store.ListVersions(in.ID)
	if err != nil {
		return "", err
	}
	return textResult(vs), nil
}

func (h *Handler) getVersion(act *Actor, input json.RawMessage) (string, error) {
	var in struct{ ID string `json:"id"` }
	_ = json.Unmarshal(input, &in)
	v, err := h.Store.GetVersionOwnedByUser(in.ID, act.ID)
	if err != nil || v == nil {
		return "版本不存在或无权访问", nil
	}
	return v.Content, nil
}

func (h *Handler) generateDiagram(ctx context.Context, act *Actor, input json.RawMessage) (string, error) {
	var in struct {
		Prompt     string `json:"prompt"`
		EngineType string `json:"engine_type"`
		ProjectID  string `json:"project_id"`
		Title      string `json:"title"`
		Save       *bool  `json:"save"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return "", err
	}
	engine := in.EngineType
	if engine == "" {
		engine = "drawio"
	}
	save := true
	if in.Save != nil {
		save = *in.Save
	}
	var currentContent string
	if in.ProjectID != "" {
		ok, _ := h.Store.UserOwnsProject(in.ProjectID, act.ID)
		if !ok {
			return "项目不存在或无权访问", nil
		}
		if v, _ := h.Store.LatestVersionOfProject(in.ProjectID); v != nil {
			currentContent = v.Content
		}
	}
	env := h.AIConfig(act.ID)
	messages := []ai.Message{
		{Role: "system", Content: gen.SystemPrompt(engine)},
		{Role: "user", Content: gen.UserContent(in.Prompt, currentContent)},
	}
	result, err := gen.Generate(ctx, messages, env, engine)
	if err != nil {
		return "生成失败：" + err.Error(), nil
	}
	if !save {
		if in.ProjectID != "" {
			_ = h.writeChat(in.ProjectID, act.ID, "user", "[MCP] "+in.Prompt)
			_ = h.writeChat(in.ProjectID, act.ID, "assistant", "[MCP] 已生成 "+engine+" 图表（未保存）")
		}
		return textResult(map[string]any{"engine_type": result.EngineType, "content": result.Content, "saved": false}), nil
	}
	projectID := in.ProjectID
	if projectID == "" {
		projectID = uuid.NewString()
		name := in.Title
		if name == "" {
			name = aiGenName()
		}
		if err := h.Store.CreateProject(projectID, act.ID, name, engine, ""); err != nil {
			return "", err
		}
	}
	changeSummary := "AI 生成：" + truncate(in.Prompt, 80)
	versionID, err := h.Store.CreateVersion(projectID, act.ID, result.Content, changeSummary)
	if err != nil {
		return "", err
	}
	_ = h.Store.TouchProject(projectID)
	_ = h.writeChat(projectID, act.ID, "user", "[MCP] "+in.Prompt)
	_ = h.writeChat(projectID, act.ID, "assistant", "[MCP] 已生成 "+engine+" 图表并保存")
	editorURL := act.BaseURL + "/editor/" + projectID
	return textResult(map[string]any{
		"project_id": projectID, "engine_type": result.EngineType, "version_id": versionID,
		"title": orNil(in.Title), "content": result.Content, "editor_url": editorURL,
		"note": "打开编辑器链接后可查看/导出 PNG/SVG；首次打开会自动生成项目缩略图",
	}), nil
}

func (h *Handler) importDiagram(act *Actor, input json.RawMessage) (string, error) {
	var in struct {
		Filename   string `json:"filename"`
		Content    string `json:"content"`
		Title      string `json:"title"`
		EngineType string `json:"engine_type"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return "", err
	}
	engine := in.EngineType
	if engine == "" {
		engine = inferEngine(in.Content, in.Filename)
	}
	title := in.Title
	if title == "" {
		title = stripExt(in.Filename)
	}
	projectID := uuid.NewString()
	if err := h.Store.CreateProject(projectID, act.ID, title, engine, ""); err != nil {
		return "", err
	}
	versionID, err := h.Store.CreateVersion(projectID, act.ID, in.Content, "文件导入")
	if err != nil {
		return "", err
	}
	editorURL := act.BaseURL + "/editor/" + projectID
	return textResult(map[string]any{
		"project_id": projectID, "title": title, "engine_type": engine, "version_id": versionID,
		"bytes": len(in.Content), "editor_url": editorURL,
		"note": "打开编辑器链接后可查看/导出 PNG/SVG；首次打开会自动生成项目缩略图",
	}), nil
}

func (h *Handler) getAccessToken(act *Actor) (string, error) {
	jti := uuid.NewString()
	token, err := h.JWT.SignWithSession(auth.Payload{
		UserId: act.ID, Username: act.Username, Name: act.Username, Role: act.Role, Jti: jti,
	}, 7*24*60*60)
	if err != nil {
		return "", err
	}
	tokenID, err := h.Store.StoreAPIToken(act.ID, jti, shaHex(token), "MCP-"+act.Username, sql.NullString{})
	if err != nil {
		return "", err
	}
	return textResult(map[string]any{
		"token": token, "token_id": tokenID, "expires_in_days": 7,
		"note": "用于 REST API 的 Authorization: Bearer 头",
	}), nil
}

func (h *Handler) writeChat(projectID, userID, role, content string) error {
	return h.Store.CreateChatMessage("", projectID, userID, role, content, "[]", "complete")
}

func aiGenName() string { return "AI生成-" + time.Now().Format("150405") }

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func orNil(s string) any {
	if s == "" {
		return json.RawMessage("null")
	}
	return s
}

func stripExt(name string) string {
	idx := -1
	for i := len(name) - 1; i >= 0; i-- {
		if name[i] == '.' {
			idx = i
			break
		}
		if name[i] == '/' || name[i] == '\\' {
			break
		}
	}
	if idx <= 0 {
		return name
	}
	return name[:idx]
}