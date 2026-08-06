package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

var userSettingKeys = map[string]bool{
	"llm.config":     true,
	"ui.preferences": true,
}

// handleGetSettings GET /api/settings/
func (a *App) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	settings, err := a.Store.ListUserSettings(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	out := map[string]any{}
	for k, v := range settings {
		var parsed any
		if err := json.Unmarshal([]byte(v), &parsed); err == nil {
			out[k] = parsed
		} else {
			out[k] = v
		}
	}
	writeJSON(w, http.StatusOK, out)
}

type putSettingReq struct {
	Key   string `json:"key"`
	Value any    `json:"value"`
}

// handlePutSettings PUT /api/settings/
func (a *App) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	var body putSettingReq
	if err := decodeBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "请求体格式无效")
		return
	}
	if body.Key == "" || !userSettingKeys[body.Key] {
		writeError(w, http.StatusBadRequest, "无效的设置项")
		return
	}
	if body.Value == nil {
		writeError(w, http.StatusBadRequest, "缺少 value")
		return
	}
	var normalized string
	switch body.Key {
	case "llm.config":
		cfg, ok := body.Value.(map[string]any)
		if !ok {
			writeError(w, http.StatusBadRequest, "无效的 LLM 配置")
			return
		}
		b, err := json.Marshal(cfg)
		if err != nil {
			writeError(w, http.StatusBadRequest, "无效的 LLM 配置")
			return
		}
		normalized = string(b)
	default:
		b, err := json.Marshal(body.Value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "无效的设置值")
			return
		}
		normalized = string(b)
	}
	if err := a.Store.PutUserSetting(user.ID, body.Key, normalized); err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	var echo any
	_ = json.Unmarshal([]byte(normalized), &echo)
	writeJSON(w, http.StatusOK, map[string]any{"key": body.Key, "value": echo})
}

// handleDeleteSetting DELETE /api/settings/:key
func (a *App) handleDeleteSetting(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	key := r.PathValue("key")
	if !userSettingKeys[key] {
		writeError(w, http.StatusBadRequest, "无效的设置项")
		return
	}
	_, _ = a.Store.DeleteUserSetting(user.ID, key)
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

// handleGetUsageToday GET /api/usage/today
func (a *App) handleGetUsageToday(w http.ResponseWriter, r *http.Request) {
	user := ctxUser(r)
	used, err := a.Store.TodayUsage(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "服务器内部错误")
		return
	}
	quota := a.dailyQuota()
	writeJSON(w, http.StatusOK, map[string]any{
		"used": used, "quota": quota,
		"date": time.Now().UTC().Format("2006-01-02"),
	})
}

// dailyQuota 读取每日配额：settings ai.daily_quota → env DAILY_QUOTA → 10。
func (a *App) dailyQuota() int {
	if v, ok, _ := a.Store.Setting("ai.daily_quota"); ok {
		if n := atoiSafe(v); n > 0 {
			return n
		}
	}
	if a.Cfg.DailyQuota > 0 {
		return a.Cfg.DailyQuota
	}
	return 10
}

func atoiSafe(s string) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return 0
}