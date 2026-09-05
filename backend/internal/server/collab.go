package server

import (
	"context"
	"net/http"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

const (
	collabSendBuffer = 64
	collabWriteTimeout = 5 * time.Second
)

// collabClient 封装一个协作连接：conn + 独立带缓冲发送队列。
// writer goroutine 负责消费 send 队列写入 conn，避免 broadcast 持锁写网络。
type collabClient struct {
	conn *websocket.Conn
	send chan []byte
	// closeOnce 保证 conn 只被 Close 一次（writer 出错与 handler 收尾可能并发触发）。
	closeOnce sync.Once
}

func (c *collabClient) writer() {
	for data := range c.send {
		ctx, cancel := context.WithTimeout(context.Background(), collabWriteTimeout)
		err := c.conn.Write(ctx, websocket.MessageText, data)
		cancel()
		if err != nil {
			// 慢客户端/断线：停止消费，等待 conn Close 触发 send 关闭。
			c.closeOnce.Do(func() { _ = c.conn.Close(websocket.StatusNormalClosure, "") })
			return
		}
	}
}

func (c *collabClient) close() {
	c.closeOnce.Do(func() { _ = c.conn.Close(websocket.StatusNormalClosure, "") })
}

// collabHub 管理协作房间（projectId → 连接集合）。
type collabHub struct {
	mu    sync.RWMutex
	rooms map[string]map[*collabClient]struct{}
}

func newCollabHub() *collabHub {
	return &collabHub{rooms: map[string]map[*collabClient]struct{}{}}
}

func (h *collabHub) add(room string, c *collabClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[room] == nil {
		h.rooms[room] = map[*collabClient]struct{}{}
	}
	h.rooms[room][c] = struct{}{}
}

func (h *collabHub) remove(room string, c *collabClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set, ok := h.rooms[room]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.rooms, room)
		}
	}
}

// broadcast 非阻塞投递消息到房间内其他客户端。
// 持有锁仅做 map 遍历与 channel 投递，不做任何网络写；
// 慢客户端 send 队列满时直接摘除并关闭，避免拖垮整个房间。
func (h *collabHub) broadcast(room string, data []byte, self *collabClient) {
	h.mu.RLock()
	clients := h.rooms[room]
	slow := make([]*collabClient, 0, 2)
	for c := range clients {
		if c == self {
			continue
		}
		select {
		case c.send <- data:
		default:
			slow = append(slow, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range slow {
		h.remove(room, c)
		c.close()
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

	client := &collabClient{conn: c, send: make(chan []byte, collabSendBuffer)}
	a.hub.add(projectID, client)
	defer func() {
		a.hub.remove(projectID, client)
		client.close()
		close(client.send)
	}()
	go client.writer()

	ctx := r.Context()
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		a.hub.broadcast(projectID, data, client)
	}
}
