package db

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

// User 对应 users 表的一条记录。
type User struct {
	ID        string     `json:"id"`
	Username  string     `json:"username"`
	Email     NullString `json:"email"`
	Password  string     `json:"-"`
	Name      string     `json:"name"`
	Role      string     `json:"role"`
	Status    string     `json:"status"`
	CreatedAt string     `json:"created_at"`
	UpdatedAt string     `json:"updated_at"`
	LastLogin NullString `json:"last_login_at"`
}

// GetUserByLoginID 按 username 或 email 精确查询用户。
func (s *Store) GetUserByLoginID(login string) (*User, error) {
	var u User
	err := s.db.QueryRow(
		`SELECT id, username, email, password_hash, name, role, status, created_at, updated_at, last_login_at
		 FROM users WHERE username = ? OR email = ?`,
		login, login,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Password, &u.Name, &u.Role, &u.Status, &u.CreatedAt, &u.UpdatedAt, &u.LastLogin)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetUserByID 通过主键查询用户（不含密码哈希）。
func (s *Store) GetUserByID(id string) (*User, error) {
	var u User
	err := s.db.QueryRow(
		`SELECT id, username, email, password_hash, name, role, status, created_at, updated_at, last_login_at
		 FROM users WHERE id = ?`,
		id,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Password, &u.Name, &u.Role, &u.Status, &u.CreatedAt, &u.UpdatedAt, &u.LastLogin)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// UserCount 统计用户总数。
func (s *Store) UserCount() (int, error) {
	var n int
	err := s.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&n)
	return n, err
}

// CreateUser 插入用户，返回新用户。role 若为空则按是否首个用户赋值 admin。
func (s *Store) CreateUser(username, email, passwordHash, name, role string) (*User, error) {
	if email == "" {
		email = ""
	}
	id := uuid.NewString()
	if role == "" {
		n, err := s.UserCount()
		if err != nil {
			return nil, err
		}
		if n == 0 {
			role = "admin"
		} else {
			role = "member"
		}
	}
	if name == "" {
		name = username
	}
	_, err := s.db.Exec(
		`INSERT INTO users (id, username, email, password_hash, name, role, status, created_at, updated_at)
		 VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		id, username, email, passwordHash, name, role,
	)
	if err != nil {
		return nil, err
	}
	return &User{ID: id, Username: username, Name: name, Role: role, Status: "active",
		CreatedAt: time.Now().Format("2006-01-02 15:04:05"), UpdatedAt: time.Now().Format(time.RFC3339)}, nil
}

// UpdateUserPassword 替换密码哈希。
func (s *Store) UpdateUserPassword(id, hash string) error {
	_, err := s.db.Exec(
		"UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		hash, id,
	)
	return err
}

// TouchLastLogin 更新最近登录时间。
func (s *Store) TouchLastLogin(id string) error {
	_, err := s.db.Exec("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", id)
	return err
}