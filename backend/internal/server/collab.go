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
func (a *App) handleCollab(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("projectId")
	if projectID == "" {
		projectID = "global"
	}

	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // 同源部署，允许任意 Origin
	})
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