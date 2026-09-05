package db

import "github.com/google/uuid"

// TodayUsage 计算某用户当日非豁免（exempt=0）的 AI 请求数。
// 用 created_at >= 当日零点 的范围比较，避免 date() 包列导致索引失效。
func (s *Store) TodayUsage(userID string) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM ai_usage
		 WHERE user_id=? AND exempt=0 AND created_at >= datetime('now','start of day')`,
		userID,
	).Scan(&n)
	return n, err
}

// RecordUsage 记录一次 AI 用量。requestKind 标记来源（chat/generate/task/mcp），
// tokens 由调用方在可获取时传入（无则 0）。
func (s *Store) RecordUsage(userID, provider, modelID, requestKind, status string, exempt bool, promptTokens, completionTokens int) error {
	e := 0
	if exempt {
		e = 1
	}
	_, err := s.db.Exec(
		`INSERT INTO ai_usage (id, user_id, provider, model_id, request_kind, prompt_tokens,
		 completion_tokens, total_tokens, exempt, status, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
		uuid.NewString(), userID, provider, modelID, requestKind,
		promptTokens, completionTokens, promptTokens+completionTokens, e, status,
	)
	return err
}
