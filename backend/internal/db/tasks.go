package db

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

// GenerateTask 对应 generate_tasks 表。
type GenerateTask struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	ProjectID     string    `json:"project_id,omitempty"`
	EngineType    string    `json:"engine_type"`
	Prompt        string    `json:"prompt"`
	Status        string    `json:"status"`
	Content       string    `json:"content"`
	ErrorMsg      string    `json:"error_msg,omitempty"`
	ChangeSummary string    `json:"change_summary"`
	CreatedAt     string    `json:"created_at"`
	StartedAt     *string   `json:"started_at,omitempty"`
	FinishedAt    *string   `json:"finished_at,omitempty"`
	t             time.Time `json:"-"`
}

// CreateGenerateTask 创建任务记录。
func (s *Store) CreateGenerateTask(userID, projectID, engine, prompt, summary string) (string, error) {
	id := uuid.NewString()
	_, err := s.db.Exec(
		`INSERT INTO generate_tasks (id, user_id, project_id, engine_type, prompt, status, change_summary)
		 VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
		id, userID, projectID, engine, prompt, summary,
	)
	if err != nil {
		return "", err
	}
	return id, nil
}

// GetGenerateTask 返回某任务（任何归属均可，供状态轮询校验）。
func (s *Store) GetGenerateTask(id string) (*GenerateTask, error) {
	row := s.db.QueryRow(
		`SELECT id, user_id, project_id, engine_type, prompt, status, content, error_msg, change_summary,
		        created_at, started_at, finished_at
		 FROM generate_tasks WHERE id = ?`, id,
	)
	var t GenerateTask
	var projectID, started, finished sql.NullString
	var content string
	if err := row.Scan(&t.ID, &t.UserID, &projectID, &t.EngineType, &t.Prompt, &t.Status,
		&content, &t.ErrorMsg, &t.ChangeSummary, &t.CreatedAt, &started, &finished); err != nil {
		return nil, err
	}
	t.ProjectID = projectID.String
	t.Content = content
	if started.Valid {
		s0 := started.String
		t.StartedAt = &s0
	}
	if finished.Valid {
		f0 := finished.String
		t.FinishedAt = &f0
	}
	return &t, nil
}

// MarkTaskRunning 标记任务开始执行。
func (s *Store) MarkTaskRunning(id string) error {
	_, err := s.db.Exec(
		"UPDATE generate_tasks SET status='running', started_at=CURRENT_TIMESTAMP WHERE id=?",
		id,
	)
	return err
}

// CompleteTask 标记任务成功并写结果。
func (s *Store) CompleteTask(id, content string) error {
	_, err := s.db.Exec(
		"UPDATE generate_tasks SET status='done', content=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",
		content, id,
	)
	return err
}

// FailTask 标记任务失败并记录错误。
func (s *Store) FailTask(id, errMsg string) error {
	_, err := s.db.Exec(
		"UPDATE generate_tasks SET status='error', error_msg=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",
		errMsg, id,
	)
	return err
}