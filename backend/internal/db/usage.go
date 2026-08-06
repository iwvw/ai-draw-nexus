package db

import "github.com/google/uuid"

// TodayUsage 计算某用户当日非豁免（exempt=0）的 AI 请求数。
func (s *Store) TodayUsage(userID string) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM ai_usage
		 WHERE user_id=? AND exempt=0 AND date(created_at)=date('now')`,
		userID,
	).Scan(&n)
	return n, err
}

// RecordUsage 记录一次 AI 用量（request_kind='chat'，tokens=0）。
func (s *Store) RecordUsage(userID, provider, status string, exempt bool) error {
	e := 0
	if exempt {
		e = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO ai_usage (id, user_id, provider, model_id, request_kind, prompt_tokens,
		 completion_tokens, total_tokens, exempt, status, created_at)
		 VALUES (?, ?, ?, '', 'chat', 0, 0, 0, ?, ?, CURRENT_TIMESTAMP)`,
		uuid.NewString(), userID, provider, e, status,
	)
	return err
}

// AIRequestsToday 统计今日全部 AI 请求数。
func (s *Store) AIRequestsToday() (int, error) {
	var n int
	err := s.db.QueryRow(
		"SELECT COUNT(*) FROM ai_usage WHERE date(created_at)=date('now')",
	).Scan(&n)
	return n, err
}