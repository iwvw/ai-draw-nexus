// Package db 的数据访问…… 本文件保存项目与版本相关查询。
package db

import (
	"database/sql"
)

// Project 对应 projects 表一条记录。
type Project struct {
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	Title      string `json:"title"`
	EngineType string `json:"engine_type"`
	Thumbnail  string `json:"thumbnail"`
	Visibility string `json:"visibility"`
	Status     string `json:"status"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

// Version 对应 versions 表一条记录（不含 content）。
type Version struct {
	ID            string     `json:"id"`
	ProjectID     string     `json:"project_id"`
	CreatedBy     NullString `json:"created_by"`
	ChangeSummary string     `json:"change_summary"`
	Timestamp     string     `json:"timestamp"`
}

// VersionDetail 含 content 的版本详情。
type VersionDetail struct {
	Version
	Content string `json:"content"`
}

// ListUserProjects 返回用户未删除的项目，按更新时间倒序。
func (s *Store) ListUserProjects(userID string) ([]Project, error) {
	rows, err := s.db.Query(
		`SELECT id, user_id, title, engine_type, thumbnail, visibility, status, created_at, updated_at
		 FROM projects WHERE user_id = ? AND status != 'deleted' ORDER BY updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.UserID, &p.Title, &p.EngineType, &p.Thumbnail,
			&p.Visibility, &p.Status, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetUserProject 查询用户本人某个未删除项目。
func (s *Store) GetUserProject(userID, id string) (*Project, error) {
	var p Project
	err := s.db.QueryRow(
		`SELECT id, user_id, title, engine_type, thumbnail, visibility, status, created_at, updated_at
		 FROM projects WHERE id = ? AND user_id = ? AND status != 'deleted'`,
		id, userID,
	).Scan(&p.ID, &p.UserID, &p.Title, &p.EngineType, &p.Thumbnail, &p.Visibility, &p.Status, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CountProjectsOfUser 统计未删除项目数。
func (s *Store) CountProjectsOfUser(userID string) (int, error) {
	var n int
	err := s.db.QueryRow(
		"SELECT COUNT(*) FROM projects WHERE user_id = ? AND status != 'deleted'", userID,
	).Scan(&n)
	return n, err
}

// TotalProjectCount 统计全部未删除项目数。
func (s *Store) TotalProjectCount() (int, error) {
	var n int
	err := s.db.QueryRow("SELECT COUNT(*) FROM projects WHERE status != 'deleted'").Scan(&n)
	return n, err
}

// CreateProject 插入项目。
func (s *Store) CreateProject(id, userID, title, engineType, thumbnail string) error {
	_, err := s.db.Exec(
		`INSERT INTO projects (id, user_id, title, engine_type, thumbnail, visibility, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, 'private', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		id, userID, title, engineType, thumbnail,
	)
	return err
}

// ProjectExists 检查项目 id 是否存在（含删除的）。
func (s *Store) ProjectExists(id string) (bool, error) {
	var n int
	err := s.db.QueryRow("SELECT COUNT(*) FROM projects WHERE id = ?", id).Scan(&n)
	return n > 0, err
}

// UpdateProjectMeta 更新 title/thumbnail 之一。
func (s *Store) UpdateProjectMeta(id, userID string, title *string, thumbnail *string) (bool, error) {
	res, err := s.db.Exec(
		`UPDATE projects SET title = COALESCE(?, title), thumbnail = COALESCE(? ,thumbnail),
		 updated_at = CURRENT_TIMESTAMP
		 WHERE id = ? AND user_id = ? AND status != 'deleted'`,
		title, thumbnail, id, userID,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// SoftDeleteProject 软删除项目。
func (s *Store) SoftDeleteProject(userID, id string) (bool, error) {
	res, err := s.db.Exec(
		"UPDATE projects SET status='deleted', updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",
		id, userID,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// TouchProject 刷新项目 updated_at。
func (s *Store) TouchProject(id string) error {
	_, err := s.db.Exec("UPDATE projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?", id)
	return err
}