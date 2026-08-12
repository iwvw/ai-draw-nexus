// Package server 提供 HTTP 路由与中间件（chi）。
package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"ai-draw-nexus/internal/db"
)

// ctxKey 用于 context 中存取请求级 user。
type ctxKey int

const userKey ctxKey = 0

// response 统一 JSON 响应辅助。
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeError 统一业务错误响应 {error: msg}。
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// writeSuccess 统一简单成功响应 {success: true}。
func writeSuccess(w http.ResponseWriter, status int) {
	writeJSON(w, status, map[string]bool{"success": true})
}

// ctxUser 从请求上下文取当前已认证用户。
func ctxUser(r *http.Request) *db.User {
	u, _ := r.Context().Value(userKey).(*db.User)
	return u
}

// withUser 将用户写入请求上下文。
func withUser(r *http.Request, u *db.User) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), userKey, u))
}

// 请求体大小上限：防止恶意大请求打满内存 / 写入超长文本。
// maxBodyBytes 为常规 JSON 接口默认上限；maxLargeBodyBytes 供
// 承载图表源码/大文档内容的接口使用（版本内容、v1 content、MCP 调用等）。
const (
	maxBodyBytes      int64 = 16 << 20 // 16MB
	maxLargeBodyBytes int64 = 256 << 20 // 256MB
)

// decodeBody 解析 JSON 请求体（受 maxBodyBytes 上限约束）；错误时返回描述。
func decodeBody(r *http.Request, dst any) error {
	return decodeBodyLimit(r, dst, maxBodyBytes)
}

// decodeBodyLimit 解析 JSON 请求体并限制请求体大小；错误时返回描述。
func decodeBodyLimit(r *http.Request, dst any, maxBytes int64) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxBytes)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return fmt.Errorf("请求体过大（上限 %d 字节）", maxBytes)
		}
		return err
	}
	return nil
}

// nullableString 将 *string 转 sql.NullString（空转为无值）。
func nullableString(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}

// stringPtr 返回字符串指针。
func stringPtr(s string) *string { return &s }