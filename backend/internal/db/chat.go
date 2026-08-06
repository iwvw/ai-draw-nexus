package db

import (
	"database/sql"
	"strings"

	"github.com/google/uuid"
)

// ChatMessage 对应 chat_messages 表一条记录。
type ChatMessage struct {
	ID          string     `json:"id"`
	ProjectID   string     `json:"project_id"`
	UserID      string     `json:"user_id"`
	Role        string     `json:"role"`
	Content     string     `json:"content"`
	Attachments string     `json:"attachments"`
	Status      string     `json:"status"`
	CreatedAt   string     `json:"created_at"`
	UpdatedAt   string     `json:"updated_at"`
}

// UserOwnsProject 判断用户是否拥有某未删除项目。
func (s *Store) UserOwnsProject(projectID, userID string) (bool, error) {
	var one int
	err := s.db.QueryRow(
		"SELECT 1 FROM projects WHERE id = ? AND user_id = ? AND status != 'deleted'",
		projectID, userID,
	).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// ListChatMessages 返回项目对话消息，按时间正序。
func (s *Store) ListChatMessages(projectID string) ([]ChatMessage, error) {
	rows, err := s.db.Query(
		`SELECT id, project_id, user_id, role, content, attachments, status, created_at, updated_at
		 FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatMessage{}
	for rows.Next() {
		var m ChatMessage
		if err := rows.Scan(&m.ID, &m.ProjectID, &m.UserID, &m.Role, &m.Content,
			&m.Attachments, &m.Status, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// CreateChatMessage 插入聊天消息，返回 id。
// attachmentJSON 以文本形式入库。
func (s *Store) CreateChatMessage(id, projectID, userID, role, content, attachmentsJSON, status string) error {
	if id == "" {
		id = uuid.NewString()
	}
	if status == "" {
		status = "complete"
	}
	if attachmentsJSON == "" {
		attachmentsJSON = "[]"
	}
	_, err := s.db.Exec(
		`INSERT INTO chat_messages (id, project_id, user_id, role, content, attachments, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		id, projectID, userID, role, content, attachmentsJSON, status,
	)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	_, err = tx.Exec("UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id=?", projectID)
	if err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// GetChatMessageProjectID 返回某消息所属项目 id 且该校验用户拥有该项目。
// 不存在或无权返回 ("", false)。
func (s *Store) GetChatMessageProjectID(msgID, userID string) (string, bool, error) {
	var pid string
	err := s.db.QueryRow(
		`SELECT m.project_id FROM chat_messages m
		 JOIN projects p ON m.project_id = p.id
		 WHERE m.id = ? AND p.user_id = ? AND p.status != 'deleted'`,
		msgID, userID,
	).Scan(&pid)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return pid, true, nil
}

// UpdateChatMessage 更新消息的 content/status/attachments。
func (s *Store) UpdateChatMessage(id string, content, status, attachments *string) (bool, error) {
	var sets []string
	var args []any
	if content != nil {
		sets = append(sets, "content = ?")
		args = append(args, *content)
	}
	if status != nil {
		sets = append(sets, "status = ?")
		args = append(args, *status)
	}
	if attachments != nil {
		sets = append(sets, "attachments = ?")
		args = append(args, *attachments)
	}
	if len(sets) == 0 {
		return false, nil
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id)
	res, err := s.db.Exec("UPDATE chat_messages SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// DeleteChatMessages 清空某项目全部消息，返回删除数。
func (s *Store) DeleteChatMessages(projectID, userID string) (int64, error) {
	res, err := s.db.Exec(
		"DELETE FROM chat_messages WHERE project_id = ? AND user_id = ?", projectID, userID,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}