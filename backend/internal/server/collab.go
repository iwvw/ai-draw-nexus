package server

import (
	"context"
	"net/http"
	"sync"

	"nhooyr.io/websocket"
)

// collabHub 管理协作房间（projectId → 连接集合）。
type collabHub struct {
	mu    sync.RWMutex
	rooms map[string]map[*websocket.Conn]struct{}
}

func newCollabHub() *collabHub {
	return &collabHub{rooms: map[string]map[*websocket.Conn]struct{}{}}
}

func (h *collabHub) add(room string, c *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[room] == nil {
		h.rooms[room] = map[*websocket.Conn]struct{}{}
	}
	h.rooms[room][c] = struct{}{}
}

func (h *collabHub) remove(room string, c *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set, ok := h.rooms[room]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.rooms, room)
		}
	}
}

func (h *collabHub) broadcast(room string, data []byte, self *websocket.Conn) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.rooms[room] {
		if c == self {
			continue
		}
		if err := c.Write(context.Background(), websocket.MessageText, data); err != nil {
			continue
		}
	}
}

// handleCollab GET /api/collab?projectId=
// 鉴权要求：登录 + 项目归属校验，并启用 Origin 校验（同源部署）。
func (a *App) handleCollab(w http.ResponseWriter, r *http.Request) {
	user := a.loadUserFromRequest(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}
	projectID := r.URL.Query().Get("projectId")
	if projectID == "" {
		writeError(w, http.StatusBadRequest, "缺少项目 ID")
		return
	}
	if ok, err := a.Store.UserOwnsProject(projectID, user.ID); err != nil || !ok {
		writeError(w, http.StatusForbidden, "项目不存在或无权访问")
		return
	}

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{})
	if err != nil {
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")

	a.hub.add(projectID, c)
	defer a.hub.remove(projectID, c)

	ctx := r.Context()
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) != -1 {
				return
			}
			return
		}
		a.hub.broadcast(projectID, data, c)
	}
}