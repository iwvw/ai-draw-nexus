package db

import (
	"database/sql"

	"github.com/google/uuid"
)

// CreateVersion 为项目插入一条版本，返回版本 id。
func (s *Store) CreateVersion(projectID, createdBy, content, changeSummary string) (string, error) {
	id := uuid.NewString()
	_, err := s.db.Exec(
		`INSERT INTO versions (id, project_id, created_by, content, change_summary, timestamp)
		 VALUES (?, ?, NULLIF(?, ''), ?, ?, CURRENT_TIMESTAMP)`,
		id, projectID, createdBy, content, changeSummary,
	)
	if err != nil {
		return "", err
	}
	return id, nil
}

// ListVersions 返回项目全部版本元信息，按时间倒序。
func (s *Store) ListVersions(projectID string) ([]Version, error) {
	rows, err := s.db.Query(
		`SELECT id, project_id, created_by, change_summary, timestamp
		 FROM versions WHERE project_id = ? ORDER BY timestamp DESC, rowid DESC`,
		projectID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Version{}
	for rows.Next() {
		var v Version
		if err := rows.Scan(&v.ID, &v.ProjectID, &v.CreatedBy, &v.ChangeSummary, &v.Timestamp); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// GetVersion 返回单个版本详情（含 content）。
func (s *Store) GetVersion(id string) (*VersionDetail, error) {
	var v VersionDetail
	err := s.db.QueryRow(
		`SELECT id, project_id, created_by, content, change_summary, timestamp
		 FROM versions WHERE id = ?`,
		id,
	).Scan(&v.ID, &v.ProjectID, &v.CreatedBy, &v.Content, &v.ChangeSummary, &v.Timestamp)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// GetVersionOwnedByUser 联表校验版本属于用户本人项目后返回。
func (s *Store) GetVersionOwnedByUser(id, userID string) (*VersionDetail, error) {
	var v VersionDetail
	err := s.db.QueryRow(
		`SELECT v.id, v.project_id, v.created_by, v.content, v.change_summary, v.timestamp
		 FROM versions v JOIN projects p ON v.project_id = p.id
		 WHERE v.id = ? AND p.user_id = ? AND p.status != 'deleted'`,
		id, userID,
	).Scan(&v.ID, &v.ProjectID, &v.CreatedBy, &v.Content, &v.ChangeSummary, &v.Timestamp)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// UpdateVersionContent 更新版本内容。
func (s *Store) UpdateVersionContent(id, content string) (bool, error) {
	res, err := s.db.Exec("UPDATE versions SET content=? WHERE id=?", content, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// DeleteVersion 删除版本。
func (s *Store) DeleteVersion(id string) (bool, error) {
	res, err := s.db.Exec("DELETE FROM versions WHERE id=?", id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// VersionCount 统计全部版本数。
func (s *Store) VersionCount() (int, error) {
	var n int
	err := s.db.QueryRow("SELECT COUNT(*) FROM versions").Scan(&n)
	return n, err
}

// LatestVersionOfProject 返回某项目最新一版（按时间倒序），无版本时返回 nil。
func (s *Store) LatestVersionOfProject(projectID string) (*VersionDetail, error) {
	var v VersionDetail
	err := s.db.QueryRow(
		`SELECT id, project_id, created_by, content, change_summary, timestamp
		 FROM versions WHERE project_id = ? ORDER BY timestamp DESC, rowid DESC LIMIT 1`,
		projectID,
	).Scan(&v.ID, &v.ProjectID, &v.CreatedBy, &v.Content, &v.ChangeSummary, &v.Timestamp)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}