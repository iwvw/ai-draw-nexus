// Package db 负责 SQLite 打开、schema 初始化与基础查询帮助。
package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	// 纯 Go SQLite 驱动，无需 cgo。
	_ "modernc.org/sqlite"
)

// Store 封装 *sql.DB 并提供应用级初始化。
type Store struct {
	db         *sql.DB
	SchemaPath string
}

// Open 打开（必要时创建）SQLite 数据库，设置 WAL 等 PRAGMA。
func Open(dbPath, schemaPath string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}

	sqlDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("打开数据库失败: %w", err)
	}
	pragmas := []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 10000",
	}
	for _, p := range pragmas {
		if _, err := sqlDB.Exec(p); err != nil {
			sqlDB.Close()
			return nil, fmt.Errorf("设置 PRAGMA(%s) 失败: %w", p, err)
		}
	}
	// SQLite 本质单写者。用单连接消除并发写的 database locked 冲突，
	// 并结合 WAL 保证读并发。这是适配 SQLite 的正确方式。
	sqlDB.SetMaxOpenConns(1)
	return &Store{db: sqlDB, SchemaPath: schemaPath}, nil
}

// Close 关闭底层数据库连接。
func (s *Store) Close() error { return s.db.Close() }

// Init 应用 schema.sql（若文件存在）并执行 seed 与首个用户提升。
// schema 文件不可用时：若库里已有表则保留；否则报错。
func (s *Store) Init() error {
	if schema, err := os.ReadFile(s.SchemaPath); err == nil {
		if _, err := s.db.Exec(string(schema)); err != nil {
			return fmt.Errorf("应用 schema 失败: %w", err)
		}
	} else {
		var name string
		err := s.db.QueryRow(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
		).Scan(&name)
		if err == sql.ErrNoRows {
			return fmt.Errorf("数据库 schema 不存在: %s", s.SchemaPath)
		}
	}

	if err := s.ensureLegacyColumns(); err != nil {
		return err
	}
	if err := s.seedSettings(); err != nil {
		return err
	}
	return s.promoteFirstUserIfNeeded()
}

// Setting 读取 settings 表中的单值。
func (s *Store) Setting(key string) (string, bool, error) {
	var v string
	err := s.db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// UpsertSetting 写入（或覆盖）settings 表某项。
func (s *Store) UpsertSetting(key, value string) error {
	_, err := s.db.Exec(
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`,
		key, value,
	)
	return err
}

func (s *Store) tableExists(name string) bool {
	var n string
	err := s.db.QueryRow(
		"SELECT name FROM sqlite_master WHERE type='table' AND name=?", name,
	).Scan(&n)
	return err == nil
}

func (s *Store) columnExists(table, col string) bool {
	rows, err := s.db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return false
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dv sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dv, &pk); err != nil {
			continue
		}
		if name == col {
			return true
		}
	}
	return false
}

func (s *Store) addColumnIfMissing(table, col, ddl string) error {
	if s.columnExists(table, col) {
		return nil
	}
	_, err := s.db.Exec("ALTER TABLE " + table + " ADD COLUMN " + ddl)
	return err
}

func (s *Store) ensureLegacyColumns() error {
	run := func(fn func() error) {
		if fn() != nil {
			// 尽力而为的迁移：失败不阻断启动
		}
	}
	if s.tableExists("users") {
		run(func() error { return s.addColumnIfMissing("users", "username", "username TEXT") })
		run(func() error { return s.addColumnIfMissing("users", "email", "email TEXT") })
		run(func() error { return s.addColumnIfMissing("users", "role", "role TEXT NOT NULL DEFAULT 'member'") })
		run(func() error { return s.addColumnIfMissing("users", "status", "status TEXT NOT NULL DEFAULT 'active'") })
		run(func() error { return s.addColumnIfMissing("users", "updated_at", "updated_at DATETIME") })
		run(func() error { return s.addColumnIfMissing("users", "last_login_at", "last_login_at DATETIME") })
		s.db.Exec(
			"UPDATE users SET username = COALESCE(NULLIF(username,''), NULLIF(email,''), id) WHERE username IS NULL OR username=''",
		)
		s.db.Exec("UPDATE users SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)")
	}
	if s.tableExists("projects") {
		run(func() error { return s.addColumnIfMissing("projects", "visibility", "visibility TEXT NOT NULL DEFAULT 'private'") })
		run(func() error { return s.addColumnIfMissing("projects", "status", "status TEXT NOT NULL DEFAULT 'active'") })
	}
	if s.tableExists("versions") {
		run(func() error { return s.addColumnIfMissing("versions", "created_by", "created_by TEXT") })
	}
	if s.tableExists("ai_usage") {
		run(func() error { return s.addColumnIfMissing("ai_usage", "status", "status TEXT NOT NULL DEFAULT 'success'") })
	}
	return nil
}

func (s *Store) seedSettings() error {
	defaults := []struct {
		key, value string
	}{
		{"ai.provider_defaults", `{"provider":"openai","baseUrl":"https://api.openai.com/v1","modelId":""}`},
		{"ai.daily_quota", envOrString("DAILY_QUOTA", "10")},
		{"security.allow_registration", envOrString("ALLOW_REGISTRATION", "true")},
		{"security.allow_public_access", envOrString("ALLOW_PUBLIC_ACCESS", "true")},
	}
	for _, d := range defaults {
		if _, err := s.db.Exec(
			"INSERT OR IGNORE INTO settings (key,value,updated_by,updated_at) VALUES (?,?,NULL,CURRENT_TIMESTAMP)",
			d.key, d.value,
		); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) promoteFirstUserIfNeeded() error {
	var adminID sql.NullString
	if err := s.db.QueryRow("SELECT id FROM users WHERE role='admin' LIMIT 1").Scan(&adminID); err == nil && adminID.Valid {
		return nil
	}
	var first sql.NullString
	err := s.db.QueryRow("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").Scan(&first)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if first.Valid {
		_, err = s.db.Exec(
			"UPDATE users SET role='admin', updated_at=CURRENT_TIMESTAMP WHERE id=?",
			first.String,
		)
		return err
	}
	return nil
}

func envOrString(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}