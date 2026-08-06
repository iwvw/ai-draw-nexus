package db

import (
	"database/sql"
	"time"
)

// GetUserSetting 读取用户设置项（无值时返回 ok=false）。
func (s *Store) GetUserSetting(userID, key string) (string, bool, error) {
	var v string
	err := s.db.QueryRow(
		"SELECT value FROM user_settings WHERE user_id=? AND key=?",
		userID, key,
	).Scan(&v)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// PutUserSetting 写入（覆盖）用户设置项。
func (s *Store) PutUserSetting(userID, key, value string) error {
	_, err := s.db.Exec(
		`INSERT INTO user_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
		userID, key, value, time.Now().Format(time.RFC3339),
	)
	return err
}

// DeleteUserSetting 删除用户设置项。
func (s *Store) DeleteUserSetting(userID, key string) (int64, error) {
	res, err := s.db.Exec(
		"DELETE FROM user_settings WHERE user_id=? AND key=?",
		userID, key,
	)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// ListUserSettings 列出用户全部设置（key ASC）。
func (s *Store) ListUserSettings(userID string) (map[string]string, error) {
	rows, err := s.db.Query(
		"SELECT key, value FROM user_settings WHERE user_id=? ORDER BY key ASC", userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}