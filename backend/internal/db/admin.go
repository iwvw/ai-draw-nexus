package db

import (
	"database/sql"
	"strconv"

	"github.com/google/uuid"
)

// AdminStat 汇总统计。
type AdminStat struct {
	Users           int `json:"users"`
	ActiveUsers     int `json:"activeUsers"`
	Admins          int `json:"admins"`
	Projects        int `json:"projects"`
	Versions        int `json:"versions"`
	AIRequestsToday int `json:"aiRequestsToday"`
}

// AdminStats 计算 admin /stats。
func (s *Store) AdminStats() (AdminStat, error) {
	var st AdminStat
	if err := s.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&st.Users); err != nil {
		return st, err
	}
	if err := s.db.QueryRow("SELECT COUNT(*) FROM users WHERE status='active'").Scan(&st.ActiveUsers); err != nil {
		return st, err
	}
	if err := s.db.QueryRow("SELECT COUNT(*) FROM users WHERE role='admin'").Scan(&st.Admins); err != nil {
		return st, err
	}
	if err := s.db.QueryRow("SELECT COUNT(*) FROM projects WHERE status != 'deleted'").Scan(&st.Projects); err != nil {
		return st, err
	}
	if err := s.db.QueryRow("SELECT COUNT(*) FROM versions").Scan(&st.Versions); err != nil {
		return st, err
	}
	if err := s.db.QueryRow("SELECT COUNT(*) FROM ai_usage WHERE date(created_at)=date('now')").Scan(&st.AIRequestsToday); err != nil {
		return st, err
	}
	return st, nil
}

// AITrendRow 每日 AI 请求统计。
type AITrendRow struct {
	Day    string `json:"day"`
	Status string `json:"status"`
	Count  int    `json:"count"`
}

// AITrend 统计近 days 天 AI 请求按日/状态。
func (s *Store) AITrend(days int) ([]AITrendRow, error) {
	rows, err := s.db.Query(
		`SELECT date(created_at) as day, status, COUNT(*) as count
		 FROM ai_usage WHERE created_at >= datetime('now', ?)
		 GROUP BY date(created_at), status ORDER BY day ASC`,
		"-"+itoa(days)+" days",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AITrendRow{}
	for rows.Next() {
		var r AITrendRow
		if err := rows.Scan(&r.Day, &r.Status, &r.Count); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AdminUserRow 管理员用户列表行。
type AdminUserRow struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	Email       NullString `json:"email"`
	Name        string     `json:"name"`
	Role        string     `json:"role"`
	Status      string     `json:"status"`
	CreatedAt   string     `json:"created_at"`
	UpdatedAt   string     `json:"updated_at"`
	LastLogin   NullString `json:"last_login_at"`
	ProjectCount int       `json:"project_count"`
}

// ListAdminUsers 返回带项目数的用户列表。
func (s *Store) ListAdminUsers(limit int) ([]AdminUserRow, error) {
	rows, err := s.db.Query(
		`SELECT u.id, u.username, u.email, u.name, u.role, u.status, u.created_at, u.updated_at, u.last_login_at,
		 COUNT(p.id) as project_count
		 FROM users u
		 LEFT JOIN projects p ON p.user_id = u.id AND p.status != 'deleted'
		 GROUP BY u.id ORDER BY u.created_at DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminUserRow{}
	for rows.Next() {
		var r AdminUserRow
		if err := rows.Scan(&r.ID, &r.Username, &r.Email, &r.Name, &r.Role, &r.Status,
			&r.CreatedAt, &r.UpdatedAt, &r.LastLogin, &r.ProjectCount); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AdminCreateUser 由管理员创建用户。
func (s *Store) AdminCreateUser(username, passwordHash, role, status string) (map[string]string, error) {
	id := uuid.NewString()
	_, err := s.db.Exec(
		`INSERT INTO users (id, username, password_hash, name, role, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		id, username, passwordHash, username, role, status,
	)
	if err != nil {
		return nil, err
	}
	return map[string]string{"id": id, "username": username, "name": username, "role": role, "status": status}, nil
}

// GetUserRoleStatus 查询用户角色与状态。
func (s *Store) GetUserRoleStatus(id string) (role, status string, exists bool, err error) {
	err = s.db.QueryRow("SELECT role, status FROM users WHERE id=?", id).Scan(&role, &status)
	if err == sql.ErrNoRows {
		return "", "", false, nil
	}
	if err != nil {
		return "", "", false, err
	}
	return role, status, true, nil
}

// AdminCount 统计启用的管理员数。
func (s *Store) AdminCount() (int, error) {
	var n int
	err := s.db.QueryRow("SELECT COUNT(*) FROM users WHERE role='admin' AND status='active'").Scan(&n)
	return n, err
}

// AdminUpdateUser 按提供的指针字段更新用户。
func (s *Store) AdminUpdateUser(id string, name, email, role, status *string) error {
	var cols []string
	var args []any
	if name != nil {
		cols = append(cols, "name = ?")
		args = append(args, *name)
	}
	if email != nil {
		cols = append(cols, "email = ?")
		args = append(args, *email)
	}
	if role != nil {
		cols = append(cols, "role = ?")
		args = append(args, *role)
	}
	if status != nil {
		cols = append(cols, "status = ?")
		args = append(args, *status)
	}
	if len(cols) == 0 {
		return nil
	}
	cols = append(cols, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id)
	_, err := s.db.Exec("UPDATE users SET "+joinComma(cols)+" WHERE id=?", args...)
	return err
}

// AdminProjectRow 管理员项目列表行。
type AdminProjectRow struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	EngineType  string     `json:"engine_type"`
	Visibility  string     `json:"visibility"`
	Status      string     `json:"status"`
	CreatedAt   string     `json:"created_at"`
	UpdatedAt   string     `json:"updated_at"`
	OwnerID     string     `json:"owner_id"`
	OwnerUsername string   `json:"owner_username"`
	OwnerEmail  NullString `json:"owner_email"`
	VersionCount int       `json:"version_count"`
}

// ListAdminProjects 返回带 owner 与版本数的项目列表。
func (s *Store) ListAdminProjects(limit int) ([]AdminProjectRow, error) {
	rows, err := s.db.Query(
		`SELECT p.id, p.title, p.engine_type, p.visibility, p.status, p.created_at, p.updated_at,
			u.id as owner_id, u.username as owner_username, u.email as owner_email,
			COUNT(v.id) as version_count
		 FROM projects p
		 JOIN users u ON u.id = p.user_id
		 LEFT JOIN versions v ON v.project_id = p.id
		 WHERE p.status != 'deleted'
		 GROUP BY p.id ORDER BY p.updated_at DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminProjectRow{}
	for rows.Next() {
		var r AdminProjectRow
		if err := rows.Scan(&r.ID, &r.Title, &r.EngineType, &r.Visibility, &r.Status,
			&r.CreatedAt, &r.UpdatedAt, &r.OwnerID, &r.OwnerUsername, &r.OwnerEmail, &r.VersionCount); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SettingRow 管理设置行。
type SettingRow struct {
	Key       string     `json:"key"`
	Value     string     `json:"value"`
	UpdatedAt string     `json:"updated_at"`
	UpdatedBy NullString `json:"updated_by_username"`
}

// ListSettings 返回全部设置。
func (s *Store) ListSettings() ([]SettingRow, error) {
	rows, err := s.db.Query(
		`SELECT s.key, s.value, s.updated_at, u.username as updated_by_username
		 FROM settings s LEFT JOIN users u ON u.id = s.updated_by ORDER BY s.key ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SettingRow{}
	for rows.Next() {
		var r SettingRow
		if err := rows.Scan(&r.Key, &r.Value, &r.UpdatedAt, &r.UpdatedBy); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// UpsertSettingBy tracks updated_by。
func (s *Store) UpsertSettingBy(key, value, updatedBy string) error {
	_, err := s.db.Exec(
		`INSERT INTO settings (key, value, updated_by, updated_at)
		 VALUES (?, ?, NULLIF(?,''), CURRENT_TIMESTAMP)
		 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`,
		key, value, updatedBy,
	)
	return err
}

// AdminUsageRow 管理员 usage 行。
type AdminUsageRow struct {
	ID              string     `json:"id"`
	Provider        string     `json:"provider"`
	ModelID         string     `json:"model_id"`
	RequestKind     string     `json:"request_kind"`
	PromptTokens    int        `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	TotalTokens     int        `json:"total_tokens"`
	Exempt          int        `json:"exempt"`
	CreatedAt       string     `json:"created_at"`
	Username        NullString `json:"username"`
}

// ListAdminUsage 返回 AI 用量列表。
func (s *Store) ListAdminUsage(limit int) ([]AdminUsageRow, error) {
	rows, err := s.db.Query(
		`SELECT a.id, a.provider, a.model_id, a.request_kind, a.prompt_tokens, a.completion_tokens,
			a.total_tokens, a.exempt, a.created_at, u.username
		 FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id
		 ORDER BY a.created_at DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminUsageRow{}
	for rows.Next() {
		var r AdminUsageRow
		if err := rows.Scan(&r.ID, &r.Provider, &r.ModelID, &r.RequestKind, &r.PromptTokens,
			&r.CompletionTokens, &r.TotalTokens, &r.Exempt, &r.CreatedAt, &r.Username); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AdminAuditRow 管理员 audit 行。
type AdminAuditRow struct {
	ID          string     `json:"id"`
	Action      string     `json:"action"`
	TargetType  string     `json:"target_type"`
	TargetID    string     `json:"target_id"`
	Metadata    string     `json:"metadata"`
	CreatedAt   string     `json:"created_at"`
	ActorUsername NullString `json:"actor_username"`
}

// ListAdminAudit 返回审计日志列表。
func (s *Store) ListAdminAudit(limit int) ([]AdminAuditRow, error) {
	rows, err := s.db.Query(
		`SELECT l.id, l.action, l.target_type, l.target_id, l.metadata, l.created_at, u.username as actor_username
		 FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_user_id
		 ORDER BY l.created_at DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminAuditRow{}
	for rows.Next() {
		var r AdminAuditRow
		if err := rows.Scan(&r.ID, &r.Action, &r.TargetType, &r.TargetID, &r.Metadata,
			&r.CreatedAt, &r.ActorUsername); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func joinComma(a []string) string {
	out := ""
	for i, s := range a {
		if i > 0 {
			out += ", "
		}
		out += s
	}
	return out
}

func itoa(n int) string { return strconv.Itoa(n) }