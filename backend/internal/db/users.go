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

// GetUserByLoginID 按 username 优先、其次 email 查询用户。
// 拆成两次查询避免 OR 命中多行时 QueryRow 返回行序不确定。
func (s *Store) GetUserByLoginID(login string) (*User, error) {
	u, err := s.getUserBy("username = ?", login)
	if err != nil || u != nil {
		return u, err
	}
	return s.getUserBy("email = ?", login)
}

func (s *Store) getUserBy(where string, arg any) (*User, error) {
	var u User
	err := s.db.QueryRow(
		`SELECT id, username, email, password_hash, name, role, status, created_at, updated_at, last_login_at
		 FROM users WHERE `+where,
		arg,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Password, &u.Name, &u.Role, &u.Status, &u.CreatedAt, &u.UpdatedAt, &u.LastLogin)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetUserByID 通过主键查询用户。查询结果包含 password_hash 字段
//（结构体上标记 json:"-" 不会序列化），调用方不得把它写入响应或日志。
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

// CreateUser 插入用户，返回新用户。
// role 为空时在事务内原子判断是否首个用户：避免并发注册读到相同 COUNT 产生多个 admin。
func (s *Store) CreateUser(username, email, passwordHash, name, role string) (*User, error) {
	id := uuid.NewString()
	if name == "" {
		name = username
	}
	insert := `INSERT INTO users (id, username, email, password_hash, name, role, status, created_at, updated_at)
		 VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`

	if role == "" {
		tx, err := s.db.Begin()
		if err != nil {
			return nil, err
		}
		defer tx.Rollback()
		var n int
		if err := tx.QueryRow("SELECT COUNT(*) FROM users").Scan(&n); err != nil {
			return nil, err
		}
		if n == 0 {
			role = "admin"
		} else {
			role = "member"
		}
		if _, err := tx.Exec(insert, id, username, email, passwordHash, name, role); err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
	} else {
		if _, err := s.db.Exec(insert, id, username, email, passwordHash, name, role); err != nil {
			return nil, err
		}
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	return &User{ID: id, Username: username, Name: name, Role: role, Status: "active",
		CreatedAt: now, UpdatedAt: now}, nil
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