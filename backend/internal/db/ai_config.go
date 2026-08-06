package db

import (
	"encoding/json"
)

// LlmConfig 与 ai 包类型一致，避免通过存储层反传入 ai。
type LlmConfig struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"baseUrl"`
	APIKey   string `json:"apiKey"`
	ModelID  string `json:"modelId"`
}

// UserLlmConfig 返回用户保存的 llm.config；未保存或无效返回 nil。
func (s *Store) UserLlmConfig(userID string) *LlmConfig {
	raw, ok, err := s.GetUserSetting(userID, "llm.config")
	if err != nil || !ok || raw == "" {
		return nil
	}
	var cfg LlmConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil
	}
	return &cfg
}

// WorkspaceLlmConfig 返回工作区 ai.provider_defaults；未保存返回 nil。
func (s *Store) WorkspaceLlmConfig() *LlmConfig {
	raw, ok, err := s.Setting("ai.provider_defaults")
	if err != nil || !ok || raw == "" {
		return nil
	}
	var cfg LlmConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil
	}
	return &cfg
}