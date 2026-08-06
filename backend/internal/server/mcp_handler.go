package server

import (
	"encoding/json"
	"net/http"

	"ai-draw-nexus/internal/mcp"
)

// mcpToolDef 是 MCP tools/list 返回的工具定义。
type mcpToolDef struct {
	Name        string      `json:"name"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

func toolSchema(required []string, props map[string]any) map[string]any {
	return map[string]any{"type": "object", "properties": props, "required": required}
}

func strProp(desc string) map[string]any     { return map[string]any{"type": "string", "description": desc} }
func enumProp(desc string, vals []string) map[string]any {
	return map[string]any{"type": "string", "description": desc, "enum": vals}
}
func boolProp(desc string) map[string]any { return map[string]any{"type": "boolean", "description": desc} }

// mcpToolDefinitions 返回全部工具定义。
func mcpToolDefinitions() []mcpToolDef {
	return []mcpToolDef{
		{
			Name: "list_projects", Title: "列出图表项目", Description: "列出当前用户所有未删除的图表项目（含引擎类型、更新时间）。",
			InputSchema: toolSchema(nil, map[string]any{}),
		},
		{
			Name: "create_project", Title: "创建图表项目", Description: "创建一个新的图表项目，返回项目 ID。引擎类型：drawio / excalidraw / mermaid。",
			InputSchema: toolSchema([]string{"title", "engine_type"}, map[string]any{
				"title": strProp("项目名称"), "engine_type": enumProp("绘图引擎", []string{"drawio", "excalidraw", "mermaid"}),
			}),
		},
		{
			Name: "get_project", Title: "获取项目详情", Description: "获取项目元信息与当前最新内容（如果存在）。",
			InputSchema: toolSchema([]string{"id"}, map[string]any{"id": strProp("项目 ID")}),
		},
		{
			Name: "get_project_content", Title: "读取图表内容", Description: "读取项目当前最新的图表源码（版本内容）。",
			InputSchema: toolSchema([]string{"id"}, map[string]any{"id": strProp("项目 ID")}),
		},
		{
			Name: "update_project_content", Title: "更新图表内容", Description: "将完整图表源码保存为新版本（内容将替换项目当前内容）。",
			InputSchema: toolSchema([]string{"id", "content"}, map[string]any{
				"id": strProp("项目 ID"), "content": strProp("完整的图表源码"), "change_summary": strProp("变更摘要（可选）"),
			}),
		},
		{
			Name: "list_versions", Title: "列出版本历史", Description: "列出项目全部历史版本（不含内容，按时间倒序）。",
			InputSchema: toolSchema([]string{"id"}, map[string]any{"id": strProp("项目 ID")}),
		},
		{
			Name: "get_version", Title: "读取版本内容", Description: "按版本 ID 读取某一历史版本的内容。",
			InputSchema: toolSchema([]string{"id"}, map[string]any{"id": strProp("版本 ID")}),
		},
		{
			Name: "generate_diagram", Title: "AI 生成图表",
			Description: "调用配置的 LLM 生成或修改图表源码，并自动保存为新项目（save 默认为 true）返回编辑器链接。传入 project_id 时更新该项目（修改场景）。",
			InputSchema: toolSchema([]string{"prompt"}, map[string]any{
				"prompt": strProp("需求描述"), "engine_type": enumProp("绘图引擎，默认 drawio", []string{"drawio", "excalidraw", "mermaid"}),
				"project_id": strProp("项目 ID（可选，提供则基于当前内容修改并更新该项目）"),
				"title":      strProp("新建项目时的标题（可选，不传自动命名）"),
				"save":       boolProp("是否保存为项目（默认 true）。false 时只返回生成内容，不落库"),
			}),
		},
		{
			Name: "import_diagram", Title: "导入图表文件",
			Description: "将一个图表文件（.mmd/.mermaid/.excalidraw/.drawio/.xml 文本内容）导入为新项目并保存为第一个版本。内容按扩展名/内容自动推断引擎，也可显式指定。",
			InputSchema: toolSchema([]string{"filename", "content"}, map[string]any{
				"filename": strProp("文件名（含扩展名），用于推断引擎"), "content": strProp("文件文本内容"),
				"title": strProp("项目名称，默认取文件名（不含扩展名）"), "engine_type": enumProp("显式指定引擎；不传则自动推断", []string{"drawio", "excalidraw", "mermaid"}),
			}),
		},
		{
			Name: "get_access_token", Title: "获取访问令牌",
			Description: "为当前用户签发一个 API 访问令牌（带 jti，可在设置页撤销）。返回 token 与过期信息。用于 REST API 调用的 Authorization: Bearer 头。",
			InputSchema: toolSchema(nil, map[string]any{}),
		},
	}
}

// mcpActor 从请求解析已认证 Actor。
func (a *App) mcpActor(r *http.Request) *mcp.Actor {
	p := a.verifyAuthPayload(r)
	if p == nil {
		return nil
	}
	u, err := a.Store.GetUserByID(p.UserId)
	if err != nil || u == nil || u.Status != "active" {
		return nil
	}
	proto := r.Header.Get("x-forwarded-proto")
	if proto == "" {
		proto = "http"
	}
	host := r.Host
	baseURL := ""
	if host != "" {
		baseURL = proto + "://" + host
	} else {
		baseURL = a.Cfg.PublicBaseURL
	}
	return &mcp.Actor{ID: u.ID, Username: u.Username, Role: u.Role, BaseURL: baseURL}
}

// handleMCP /mcp 入口：CORS + 鉴权 + JSON-RPC 分发。
func (a *App) handleMCP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("access-control-allow-origin", "*")
	w.Header().Set("access-control-allow-methods", "GET, POST, OPTIONS")
	w.Header().Set("access-control-allow-headers", "authorization, content-type, mcp-session-id")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	actor := a.mcpActor(r)
	if actor == nil {
		writeJSONRPCErr(w, http.StatusUnauthorized, -32001, "未授权：请携带有效的 Bearer Token", nil)
		return
	}

	if r.Method == http.MethodGet {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("event: message\ndata: {\"jsonrpc\":\"2.0\"}\n\n"))
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      any             `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}
	if err := decodeBody(r, &req); err != nil {
		writeJSONRPCErr(w, http.StatusBadRequest, -32700, "解析失败：无效 JSON", nil)
		return
	}
	id := req.ID

	switch req.Method {
	case "initialize":
		writeJSONRPC(w, http.StatusOK, map[string]any{
			"jsonrpc": "2.0", "id": id,
			"result": map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "ai-draw-nexus", "version": "1.0.0"},
			},
		})
	case "tools/list":
		writeJSONRPC(w, http.StatusOK, map[string]any{
			"jsonrpc": "2.0", "id": id, "result": map[string]any{"tools": mcpToolDefinitions()},
		})
	case "tools/call":
		var params struct {
			Name   string          `json:"name"`
			Inputs json.RawMessage `json:"input"`
		}
		_ = json.Unmarshal(req.Params, &params)
		result, err := a.Mcp.CallTool(r.Context(), actor, params.Name, params.Inputs)
		if err != nil {
			writeJSONRPCErr(w, http.StatusInternalServerError, -32603, err.Error(), id)
			return
		}
		writeJSONRPC(w, http.StatusOK, map[string]any{
			"jsonrpc": "2.0", "id": id,
			"result": map[string]any{"content": []map[string]string{{"type": "text", "text": result}}},
		})
	default:
		writeJSONRPCErr(w, http.StatusNotFound, -32601, "方法不存在: "+req.Method, id)
	}
}

func writeJSONRPCErr(w http.ResponseWriter, status int, code int, msg string, id any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": "2.0", "id": id,
		"error": map[string]any{"code": code, "message": msg},
	})
}

func writeJSONRPC(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}