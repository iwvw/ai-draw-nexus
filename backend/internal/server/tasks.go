package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"

	"ai-draw-nexus/internal/gen"
)

// queuedTask 一条异步生成任务（提交稍后被执行）。
type queuedTask struct {
	taskID      string
	userID      string
	projectID   string
	engine      string
	prompt      string
	summary     string
	attachments string // JSON 数组（附件元数据，用于持久化 user 消息）
}

// taskQueue 后端异步生成队列。串行 worker 消费，避免 SQLite 单写连接竞争。
type taskQueue struct {
	mu sync.Mutex
	ch chan queuedTask
	// worker 绑定的 App 引用，用于执行时写库。
	app *App
}

// newTaskQueue 返回一个挂载在 app 上的任务队列（不自动启动 worker）。
func (a *App) newTaskQueue() *taskQueue {
	return &taskQueue{ch: make(chan queuedTask, 4096), app: a}
}

// start 启动 worker goroutine（幂等）。
func (q *taskQueue) start() {
	go func() {
		for t := range q.ch {
			q.run(t)
		}
	}()
}

// enqueue 入队。
func (q *taskQueue) enqueue(t queuedTask) { q.ch <- t }

// run 执行单个任务：标记 running → 生成 → 写版本+聊天 → 标记 done/error。
func (q *taskQueue) run(t queuedTask) {
	app := q.app
	_ = app.Store.MarkTaskRunning(t.taskID)

	user, err := app.Store.GetUserByID(t.userID)
	if err != nil {
		_ = app.Store.FailTask(t.taskID, "用户不存在或已被删除")
		return
	}
	env := app.resolveEnvForUser(user.ID)
	ctx := context.Background()
	// 修改场景：以项目当前最新版本作为上下文；全新生成则为空。
	currentContent := ""
	if t.projectID != "" {
		if latest, err := app.Store.LatestVersionOfProject(t.projectID); err == nil && latest != nil {
			currentContent = latest.Content
		}
	}
	messages := app.mergeGenMessages(t.userID, t.engine, t.prompt, currentContent)
	result, err := gen.Generate(ctx, messages, env, t.engine)
	if err != nil {
		_ = app.Store.FailTask(t.taskID, err.Error())
		return
	}

	// 全链路持久化：新版本 + 用户/助手聊天消息。
	if t.projectID != "" {
		if _, err := app.Store.CreateVersion(t.projectID, t.userID, result.Content, t.summary); err == nil {
			_ = app.Store.TouchProject(t.projectID)
		}
		_ = app.Store.CreateChatMessage("", t.projectID, t.userID, "user", t.prompt, t.attachments, "complete")
		_ = app.Store.CreateChatMessage("", t.projectID, t.userID, "assistant", result.Content, "[]", "complete")
	}
	if err := app.Store.CompleteTask(t.taskID, result.Content); err != nil {
		return
	}
}

// createGenTaskReq POST /api/generate-tasks 请求体。
type createGenTaskReq struct {
	ProjectID     string          `json:"project_id"`
	Engine        string          `json:"engine_type"`
	Prompt        string          `json:"prompt"`
	ChangeSummary string          `json:"change_summary"`
	Attachments   json.RawMessage `json:"attachments"`
}

// normalizeAttachments 把请求中的附件数组规整为 JSON 字符串；
// 无附件或非法时返回 "[]"。
func normalizeAttachments(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return "[]"
	}
	var arr []any
	if err := json.Unmarshal(raw, &arr); err != nil {
		// 兼容前端传 JSON 字符串的情况
		var s string
		if err2 := json.Unmarshal(raw, &s); err2 == nil && s != "" {
			return s
		}
		return "[]"
	}
	b, _ := json.Marshal(arr)
	return string(b)
}

// handleCreateGenerateTask POST /api/generate-tasks
// 创建异步生成任务并立即返回 task_id；后台 worker 生成并持久化。
func (a *App) handleCreateGenerateTask(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	var body createGenTaskReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	if body.Prompt == "" {
		writeError(w, http.StatusBadRequest, "请输入提示词")
		return
	}
	// 不限制 prompt 长度：允许用户完整上传大文档供 AI 参考。
	if body.Engine == "" {
		body.Engine = "drawio"
	}
	switch body.Engine {
	case "drawio", "excalidraw", "mermaid":
	default:
		writeError(w, http.StatusBadRequest, "无效的引擎类型")
		return
	}
	projectID := body.ProjectID
	if projectID != "" {
		if ok, _ := a.Store.UserOwnsProject(projectID, user.ID); !ok {
			writeError(w, http.StatusNotFound, "项目不存在或无权访问")
			return
		}
	}
	summary := body.ChangeSummary
	if summary == "" {
		summary = "AI 生成"
	}
	taskID, err := a.Store.CreateGenerateTask(user.ID, projectID, body.Engine, body.Prompt, summary)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	a.taskQ.enqueue(queuedTask{
		taskID: taskID, userID: user.ID, projectID: projectID,
		engine: body.Engine, prompt: body.Prompt, summary: summary,
		attachments: normalizeAttachments(body.Attachments),
	})
	writeJSON(w, http.StatusAccepted, map[string]string{
		"task_id": taskID, "project_id": projectID, "status": "pending",
	})
}

// handleGetGenerateTask GET /api/generate-tasks/{id}
// 轮询任务状态，仅限任务归属用户。
func (a *App) handleGetGenerateTask(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.PathValue("id")
	t, err := a.Store.GetGenerateTask(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "任务不存在")
		return
	}
	if t.UserID != user.ID {
		writeError(w, http.StatusForbidden, "无权访问该任务")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"task_id":     t.ID,
		"project_id":  t.ProjectID,
		"engine_type": t.EngineType,
		"status":      t.Status,
		"content":     t.Content,
		"error":       t.ErrorMsg,
	})
}