package db

import (
	"database/sql"
	"database/sql/driver"
	"encoding/json"
)

// NullString 包装 sql.NullString，JSON 序列化与 TS 端一致：
// 有效值为字符串，无效值为 null。
type NullString struct {
	sql.NullString
}

// MarshalJSON 输出字符串或 null。
func (n NullString) MarshalJSON() ([]byte, error) {
	if !n.Valid {
		return []byte("null"), nil
	}
	return json.Marshal(n.String)
}

// Scan 实现 sql.Scanner，支持直接扫描到 NullString。
func (n *NullString) Scan(value any) error {
	return n.NullString.Scan(value)
}

// Value 实现 driver.Valuer。
func (n NullString) Value() (driver.Value, error) {
	return n.NullString.Value()
}

// NewNullString 构造带值的 NullString。
func NewNullString(s string) NullString {
	return NullString{sql.NullString{String: s, Valid: s != ""}}
}

// Str 返回字符串值（无效时返回空串）。
func (n NullString) Str() string {
	if !n.Valid {
		return ""
	}
	return n.String
}