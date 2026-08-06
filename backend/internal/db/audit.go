package db

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

// AuditEntry 对应 audit_logs 表一条记录。
type AuditEntry struct {
	ID        string         `json:"id"`
	ActorID   sql.NullString `json:"actor_user_id"`
	Action    string         `json:"action"`
	Target    string         `json:"target_type"`
	TargetID  sql.NullString `json:"target_id"`
	Metadata  string         `json:"metadata"`
	CreatedAt string         `json:"created_at"`
}

// RecordAudit 写入一条审计记录（失败不阻断调用方）。
func (s *Store) RecordAudit(actorID, action, targetType, targetID, metadata string) {
	if metadata == "" {
		metadata = "{}"
	}
	_, err := s.db.Exec(
		`INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at)
		 VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, CURRENT_TIMESTAMP)`,
		uuid.NewString(), actorID, action, targetType, targetID, metadata,
	)
	if err != nil {
		// 审计写入失败不影响主业务流程
		_ = err
	}
}

// API token 相关。

// API Token 记录
type APIToken struct {
	ID          string         `json:"id"`
	UserID      string         `json:"user_id"`
	Name        string         `json:"name"`
	Jti         string         `json:"jti"`
	ExpiresAt   sql.NullString `json:"expires_at"`
	LastUsedAt  sql.NullString `json:"last_used_at"`
	CreatedAt   string         `json:"created_at"`
	RevokedAt   sql.NullString `json:"revoked_at"`
}

// IsAPITokenValid 判断 jti 对应的 token 未撤销且未过期。
func (s *Store) IsAPITokenValid(jti string) bool {
	var revoked, expires sql.NullString
	err := s.db.QueryRow(
		"SELECT revoked_at, expires_at FROM api_tokens WHERE jti = ?", jti,
	).Scan(&revoked, &expires)
	if err != nil {
		return false
	}
	if revoked.Valid {
		return false
	}
	if expires.Valid && expires.String != "" {
		if t, perr := time.Parse(time.RFC3339, expires.String); perr == nil && t.Before(time.Now()) {
			return false
		}
	}
	return true
}

// StoreAPIToken 存储 API token（tokenHash 为 sha256 hex）。
func (s *Store) StoreAPIToken(userID, jti, tokenHash, name string, expiresAt sql.NullString) (string, error) {
	id := uuid.NewString()
	_, err := s.db.Exec(
		`INSERT INTO api_tokens (id, user_id, name, token_hash, jti, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
		id, userID, name, tokenHash, jti, expiresAt,
	)
	if err != nil {
		return "", err
	}
	return id, nil
}

// ListAPITokens 返回用户所有未撤销 token，按创建时间倒序。
func (s *Store) ListAPITokens(userID string) ([]APIToken, error) {
	rows, err := s.db.Query(
		`SELECT id, user_id, name, jti, expires_at, last_used_at, created_at, revoked_at
		 FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []APIToken{}
	for rows.Next() {
		var t APIToken
		if err := rows.Scan(&t.ID, &t.UserID, &t.Name, &t.Jti, &t.ExpiresAt, &t.LastUsedAt,
			&t.CreatedAt, &t.RevokedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// RevokeAPIToken 撤销指定用户下某 token；返回是否成功（存在且可撤销）。
func (s *Store) RevokeAPIToken(userID, id string) (bool, error) {
	res, err := s.db.Exec(
		`UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP
		 WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
		id, userID,
	)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}