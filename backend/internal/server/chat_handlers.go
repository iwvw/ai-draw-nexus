package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

type createChatReq struct {
	ID          string          `json:"id"`
	ProjectID   string          `json:"project_id"`
	Role        string          `json:"role"`
	Content     string          `json:"content"`
	Attachments []json.RawMessage `json:"attachments"`
	Status      string          `json:"status"`
}

type updateChatReq struct {
	Content     *string         `json:"content"`
	Status      *string         `json:"status"`
	Attachments []json.RawMessage `json:"attachments"`
}

var chatStatuses = map[string]bool{"pending": true, "streaming": true, "complete": true, "error": true}

// handleListChat GET /api/chat/history/?project_id=
func (a *App) handleListChat(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	pid := r.URL.Query().Get("project_id")
	if pid == "" {
		writeError(w, http.StatusBadRequest, "缺少项目 ID")
		return
	}
	if ok, err := a.Store.UserOwnsProject(pid, user.ID); err != nil || !ok {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	messages, err := a.Store.ListChatMessages(pid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

// chatCreate POST /api/chat/history/
func (a *App) handleCreateChat(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	var body createChatReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	if body.Content == "" || len(body.Content) > 200000 {
		writeError(w, http.StatusBadRequest, "消息内容过长")
		return
	}
	if body.Role != "user" && body.Role != "assistant" && body.Role != "system" {
		writeError(w, http.StatusBadRequest, "无效的消息角色")
		return
	}
	if body.Status != "" && !chatStatuses[body.Status] {
		writeError(w, http.StatusBadRequest, "无效的消息状态")
		return
	}
	if len(body.ID) > 64 {
		writeError(w, http.StatusBadRequest, "消息 ID 无效")
		return
	}
	if body.ProjectID == "" {
		writeError(w, http.StatusBadRequest, "项目 ID 无效")
		return
	}
	if ok, _ := a.Store.UserOwnsProject(body.ProjectID, user.ID); !ok {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	attachmentsJSON, _ := json.Marshal(body.Attachments)
	if body.Attachments == nil {
		attachmentsJSON = []byte("[]")
	}
	if err := a.Store.CreateChatMessage(body.ID, body.ProjectID, user.ID, body.Role,
		body.Content, string(attachmentsJSON), body.Status); err != nil {
		// 幂等场景：同一客户端 ID 已存在（如重试）时视为已创建成功。
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			msgID := body.ID
			if msgID == "" {
				msgID = uuid.NewString()
			}
			writeJSON(w, http.StatusOK, map[string]string{"id": msgID, "project_id": body.ProjectID})
			return
		}
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	msgID := body.ID
	if msgID == "" {
		msgID = uuid.NewString()
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": msgID, "project_id": body.ProjectID})
}

// handleUpdateChat PUT /api/chat/history/:id
func (a *App) handleUpdateChat(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	id := r.PathValue("id")
	var body updateChatReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	pid, ok, err := a.Store.GetChatMessageProjectID(id, user.ID)
	if err != nil || !ok {
		writeError(w, http.StatusNotFound, "消息不存在或无权访问")
		return
	}
	if body.Content == nil && body.Status == nil && body.Attachments == nil {
		writeError(w, http.StatusBadRequest, "没有可更新的字段")
		return
	}
	var attJSON *string
	if body.Attachments != nil {
		b, _ := json.Marshal(body.Attachments)
		s := string(b)
		attJSON = &s
	}
	upd, err := a.Store.UpdateChatMessage(id, body.Content, body.Status, attJSON)
	if err != nil || !upd {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	_ = a.Store.TouchProject(pid)
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// handleClearChat DELETE /api/chat/history/?project_id=
func (a *App) handleClearChat(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	pid := r.URL.Query().Get("project_id")
	if pid == "" {
		writeError(w, http.StatusBadRequest, "缺少项目 ID")
		return
	}
	if ok, _ := a.Store.UserOwnsProject(pid, user.ID); !ok {
		writeError(w, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	count, err := a.Store.DeleteChatMessages(pid, user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	a.Store.RecordAudit(user.ID, "chat.clear", "project", pid,
		`{"deleted":`+strconv.FormatInt(count, 10)+`}`)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "deleted": count})
}