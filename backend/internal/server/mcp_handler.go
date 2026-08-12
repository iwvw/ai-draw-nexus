package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"ai-draw-nexus/internal/mcp"

	"github.com/google/uuid"
)

// mcpToolDef 是 MCP tools/list 返回的工具定义。
type mcpToolDef struct {
	Name        string      `json:"name"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

func toolSchema(required []string, props map[string]any) map[string]any {
	if required == nil {
		required = []string{}
	}
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
	// 生成对外编辑器链接的基址：优先显式配置 PUBLIC_BASE_URL，
	// 其次 x-forwarded-host（vite/反代透传的真实前端地址），最后 r.Host 兜底。
	// 避免 dev 下 vite 代理 changeOrigin 把 Host 改写为后端端口导致链接指向 8787。
	baseURL := a.Cfg.PublicBaseURL
	if baseURL == "" {
		host := r.Header.Get("x-forwarded-host")
		if host == "" {
			host = r.Host
		}
		proto := r.Header.Get("x-forwarded-proto")
		if proto == "" {
			proto = "http"
		}
		if host != "" {
			baseURL = proto + "://" + host
		}
	}
	return &mcp.Actor{ID: u.ID, Username: u.Username, Role: u.Role, BaseURL: baseURL}
}

// handleMCP /mcp 入口：CORS + 鉴权 + JSON-RPC 分发。
// 同时支持两种 MCP 传输：
//   - 经典 SSE 传输（opencode remote 使用）：GET 建立 SSE 长连接并返回 endpoint 事件，
//     后续 POST /mcp?sessionId=<id> 通过该流回发响应。
//   - Streamable HTTP：无 session 的 POST，响应直接以 JSON body 返回。
func (a *App) handleMCP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("access-control-allow-origin", "*")
	w.Header().Set("access-control-allow-methods", "GET, POST, OPTIONS")
	w.Header().Set("access-control-allow-headers", "authorization, content-type, mcp-session-id")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if os.Getenv("MCP_DEBUG") == "1" {
		_, _ = fmt.Fprintf(os.Stderr, "[mcp] %s %s session=%q auth=%v\n", r.Method, r.URL.String(), r.URL.Query().Get("sessionId"), r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "")
	}

	actor := a.mcpActor(r)
	if actor == nil {
		writeJSONRPCErr(w, http.StatusUnauthorized, -32001, "未授权：请携带有效的 Bearer Token", nil)
		return
	}

	// ---- SSE 传输 ----
	if r.Method == http.MethodGet {
		a.serveMCPSSE(w, r)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	// POST 携带 sessionId：属于 SSE 传输，响应通过 SSE 流回给 GET 端。
	if sid := r.URL.Query().Get("sessionId"); sid != "" {
		a.sseMu.Lock()
		ch, ok := a.sseStreams[sid]
		a.sseMu.Unlock()
		if !ok {
			writeJSONRPCErr(w, http.StatusNotFound, -32002, "SSE 会话不存在", nil)
			return
		}
		resp, _ := a.handleJSONRPC(r, actor)
		// 双模兼容：响应同时经 SSE 推送、并在 POST body 返回。
		//   - SSE/Streamable 客户端读 body → 200 + JSON。
		//   - 经典 SSE 客户端读 GET 流 → 由下方 ch <- frame 推送。
		if resp != nil {
			frame := []byte("event: message\ndata: " + strings.TrimSpace(string(resp)) + "\n\n")
			select {
			case ch <- frame:
			default:
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(200)
			_, _ = w.Write(resp)
			return
		}
		// 无响应的通知：HTTP 202 已接受，不产生响应体。
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{}`))
		return
	}

	// ---- Streamable HTTP（无 session，直接返回 JSON body）----
	resp, status := a.handleJSONRPC(r, actor)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if resp != nil {
		_, _ = w.Write(resp)
	}
}

// handleJSONRPC 解析并分派一个 JSON-RPC 请求，返回序列化后的响应 JSON 与 HTTP 状态码。
func (a *App) handleJSONRPC(r *http.Request, actor *mcp.Actor) ([]byte, int) {
	var req struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      any             `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}
	if err := decodeBodyLimit(r, &req, maxLargeBodyBytes); err != nil {
		e, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": nil, "error": map[string]any{"code": -32700, "message": "解析失败：无效 JSON"}})
		return e, http.StatusBadRequest
	}
	id := req.ID

	switch req.Method {
	case "initialize":
		b, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0", "id": id,
			"result": map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": "ai-draw-nexus", "version": "1.0.0"},
			},
		})
		return b, http.StatusOK
	case "tools/list":
		b, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0", "id": id, "result": map[string]any{"tools": mcpToolDefinitions()},
		})
		return b, http.StatusOK
	case "tools/call":
		var params struct {
			Name   string          `json:"name"`
			Inputs json.RawMessage `json:"arguments"`
		}
		_ = json.Unmarshal(req.Params, &params)
		if len(params.Inputs) == 0 {
			var legacy struct {
				Inputs json.RawMessage `json:"input"`
			}
			_ = json.Unmarshal(req.Params, &legacy)
			params.Inputs = legacy.Inputs
		}
		// generate_diagram 消耗 LLM 配额：调用前检查+预留，完成后记录 usage。
		reserved, exempt, trackUsage := false, false, false
		if params.Name == "generate_diagram" {
			if u, e := a.Store.GetUserByID(actor.ID); e == nil && u != nil {
				exempt = a.requestExempt(r, u)
				if !exempt {
					if !a.reserveQuota(actor.ID) {
						e, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": -32003, "message": "今日 AI 配额已用完"}})
						return e, http.StatusTooManyRequests
					}
					reserved = true
				}
				trackUsage = true
			}
		}
		result, err := a.Mcp.CallTool(r.Context(), actor, params.Name, params.Inputs)
		if params.Name == "generate_diagram" && trackUsage {
			status := "success"
			if err != nil {
				status = "failed"
			}
			provider := "openai"
			if a.Cfg.AIProvider != "" {
				provider = a.Cfg.AIProvider
			}
			// 先落 usage 再释放预留，缩小竞态窗口；豁免请求仅记录不预留/释放。
			_ = a.Store.RecordUsage(actor.ID, provider, status, exempt)
			if reserved {
				a.releaseQuota(actor.ID)
			}
		}
		if err != nil {
			e, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": -32603, "message": err.Error()}})
			return e, http.StatusInternalServerError
		}
		b, _ := json.Marshal(map[string]any{
			"jsonrpc": "2.0", "id": id,
			"result": map[string]any{"content": []map[string]string{{"type": "text", "text": result}}},
		})
		return b, http.StatusOK
	// 单个值是 handleJSONRPC 返回的 JSON 响应。空响应(通知)用 nil。
	case "ping":
		if id == nil {
			return nil, http.StatusAccepted
		}
		b, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{}})
		return b, http.StatusOK
	default:
		// 无 id 的 JSON-RPC 通知（如 notifications/initialized）：按规范以 202 接受，不产生响应。
		if id == nil {
			return nil, http.StatusAccepted
		}
		e, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": -32601, "message": "方法不存在: " + req.Method}})
		return e, http.StatusNotFound
	}
}

// serveMCPSSE 建立 SSE 长连接：先发 endpoint 事件告知 POST 回传地址，再持续把响应经 SSE 流推送给客户端。
func (a *App) serveMCPSSE(w http.ResponseWriter, r *http.Request) {
	id := randomSID()
	ch := make(chan []byte, 64)

	a.sseMu.Lock()
	a.sseStreams[id] = ch
	a.sseMu.Unlock()
	defer func() {
		a.sseMu.Lock()
		delete(a.sseStreams, id)
		a.sseMu.Unlock()
	}()

	proto := r.Header.Get("x-forwarded-proto")
	if proto == "" {
		proto = "http"
	}
	endpoint := proto + "://" + r.Host + "/mcp?sessionId=" + url.QueryEscape(id)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	fl, ok := w.(http.Flusher)
	if !ok {
		return
	}

	if _, err := fmt.Fprintf(w, "event: endpoint\ndata: %s\n\n", endpoint); err != nil {
		return
	}
	fl.Flush()

	hb := time.NewTicker(25 * time.Second)
	defer hb.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-hb.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			fl.Flush()
		case frame, ok := <-ch:
			if !ok {
				return
			}
			if _, err := w.Write(frame); err != nil {
				return
			}
			fl.Flush()
		}
	}
}

func randomSID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand 失败（极罕见）：用 uuid 兜底，避免暴露可预测会话 ID。
		return strings.ReplaceAll(uuid.NewString(), "-", "")[:32]
	}
	return hex.EncodeToString(b)
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