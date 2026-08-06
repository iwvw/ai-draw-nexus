// Package server_test 集成测试：验证 auth/projects/chat/admin 的关键契约。
package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"ai-draw-nexus/internal/auth"
	"ai-draw-nexus/internal/config"
	"ai-draw-nexus/internal/db"
	"ai-draw-nexus/internal/server"
)

type testCtx struct {
	srv *httptest.Server
}

func newTestServer(t *testing.T) *testCtx {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	store, err := db.Open(dbPath, schemaPath())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := store.Init(); err != nil {
		t.Fatalf("init db: %v", err)
	}
	cfg := &config.Config{
		Port: "0", DBPath: dbPath, JWTSecret: "test-secret",
		AIProvider: "openai", AIBaseURL: "https://api.openai.com/v1", AIModelID: "gpt-4o-mini",
		DistDir: t.TempDir(), DailyQuota: 10,
	}
	app := server.New(store, auth.NewJWTService(cfg.JWTSecret), cfg)
	srv := httptest.NewServer(app.Routes())
	t.Cleanup(func() { srv.Close(); store.Close() })
	return &testCtx{srv: srv}
}

func schemaPath() string {
	wd, _ := os.Getwd()
	for _, cand := range []string{
		filepath.Join(wd, "..", "data", "schema.sql"),
		filepath.Join(wd, "..", "..", "data", "schema.sql"),
		filepath.Join(wd, "data", "schema.sql"),
	} {
		if info, err := os.Stat(cand); err == nil && !info.IsDir() {
			return cand
		}
	}
	return filepath.Join(wd, "data", "schema.sql")
}

// doJSON 发 JSON 请求，返回解码为 any 的结果。
func (tc *testCtx) doJSON(t *testing.T, method, path, token string, body any) (int, any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, err := http.NewRequest(method, tc.srv.URL+path, &buf)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do %s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	var out any
	if resp.ContentLength != 0 {
		_ = json.NewDecoder(resp.Body).Decode(&out)
	}
	return resp.StatusCode, out
}

// register 注册并返回 token。
func (tc *testCtx) register(t *testing.T, username string) string {
	t.Helper()
	st, data := tc.doJSON(t, "POST", "/api/auth/register", "", map[string]any{
		"username": username, "password": "secret123",
	})
	if st != 201 {
		t.Fatalf("register %s: got %d", username, st)
	}
	m, _ := data.(map[string]any)
	tok, _ := m["token"].(string)
	return tok
}

// obj 断言 data 是 map 并返回。
func asObj(t *testing.T, data any) map[string]any {
	t.Helper()
	m, _ := data.(map[string]any)
	return m
}

// fields 断言数组元素第一项是 map 并返回。
func asArrObj(t *testing.T, data any) []map[string]any {
	t.Helper()
	arr, _ := data.([]any)
	out := []map[string]any{}
	for _, e := range arr {
		if m, ok := e.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func TestFirstUserAdminAndAdminRoutes(t *testing.T) {
	tc := newTestServer(t)
	adminTok := tc.register(t, "admin")
	memberTok := tc.register(t, "member")

	if st, _ := tc.doJSON(t, "GET", "/api/admin/stats", memberTok, nil); st != 403 {
		t.Fatalf("member denied admin expected 403, got %d", st)
	}

	st, data := tc.doJSON(t, "GET", "/api/admin/stats", adminTok, nil)
	if st != 200 {
		t.Fatalf("admin stats expected 200, got %d", st)
	}
	m := asObj(t, data)
	if m["users"].(float64) != 2 || m["admins"].(float64) != 1 {
		t.Fatalf("expected users=2 admins=1, got %v/%v", m["users"], m["admins"])
	}
}

func TestProjectOwnerScope(t *testing.T) {
	tc := newTestServer(t)
	owner := tc.register(t, "owner")
	outsider := tc.register(t, "outsider")

	st, data := tc.doJSON(t, "POST", "/api/projects", owner, map[string]any{
		"title": "Owner project", "engine_type": "mermaid",
	})
	if st != 201 {
		t.Fatalf("create project expected 201, got %d", st)
	}
	id := asObj(t, data)["id"].(string)

	if st, _ := tc.doJSON(t, "GET", "/api/projects/detail?id="+id, outsider, nil); st != 404 {
		t.Fatalf("outsider get expected 404, got %d", st)
	}
	if st, _ := tc.doJSON(t, "GET", "/api/projects/detail?id="+id, owner, nil); st != 200 {
		t.Fatalf("owner get expected 200, got %d", st)
	}
}

func TestSuspendedUserBlockedFromLogin(t *testing.T) {
	tc := newTestServer(t)
	adminTok := tc.register(t, "admin")
	_ = tc.register(t, "member")

	st, data := tc.doJSON(t, "GET", "/api/admin/users", adminTok, nil)
	if st != 200 {
		t.Fatalf("list users expected 200, got %d", st)
	}
	arr := asArr(t, data)
	var memberID string
	for _, e := range arr {
		m := e.(map[string]any)
		if m["username"] == "member" {
			memberID = m["id"].(string)
		}
	}
	if memberID == "" {
		t.Fatal("member user not found")
	}

	if st, _ := tc.doJSON(t, "PATCH", "/api/admin/users/"+memberID, adminTok, map[string]any{
		"status": "suspended",
	}); st != 200 {
		t.Fatalf("suspend member expected 200, got %d", st)
	}

	st, _ = tc.doJSON(t, "POST", "/api/auth/login", "", map[string]any{
		"username": "member", "password": "secret123",
	})
	if st != 403 {
		t.Fatalf("suspended login expected 403, got %d", st)
	}
}

func TestChatHistoryScope(t *testing.T) {
	tc := newTestServer(t)
	owner := tc.register(t, "alice")
	outsider := tc.register(t, "bob")

	st, data := tc.doJSON(t, "POST", "/api/projects", owner, map[string]any{
		"title": "Chat project", "engine_type": "mermaid",
	})
	if st != 201 {
		t.Fatalf("create project expected 201, got %d", st)
	}
	id := asObj(t, data)["id"].(string)

	st, _ = tc.doJSON(t, "POST", "/api/chat/history", owner, map[string]any{
		"project_id": id, "role": "user", "content": "画一个流程图", "status": "complete",
	})
	if st != 201 {
		t.Fatalf("save chat expected 201, got %d", st)
	}

	st, data = tc.doJSON(t, "GET", "/api/chat/history?project_id="+id, owner, nil)
	if st != 200 {
		t.Fatalf("owner history expected 200, got %d", st)
	}
	if arr := asArr(t, data); len(arr) != 1 {
		t.Fatalf("history len expected 1, got %d", len(arr))
	}

	if st, _ := tc.doJSON(t, "GET", "/api/chat/history?project_id="+id, outsider, nil); st != 404 {
		t.Fatalf("outsider history expected 404, got %d", st)
	}
}

func TestLLMSettingsAndUsage(t *testing.T) {
	tc := newTestServer(t)
	tok := tc.register(t, "alice")

	st, _ := tc.doJSON(t, "PUT", "/api/settings", tok, map[string]any{
		"key": "llm.config",
		"value": map[string]any{
			"provider": "openai", "baseUrl": "https://api.example.com/v1",
			"apiKey": "sk-test-123", "modelId": "gpt-4o-mini",
		},
	})
	if st != 200 {
		t.Fatalf("save settings expected 200, got %d", st)
	}

	st, data := tc.doJSON(t, "GET", "/api/settings", tok, nil)
	if st != 200 {
		t.Fatalf("load settings expected 200, got %d", st)
	}
	m := asObj(t, data)
	cfg, _ := m["llm.config"].(map[string]any)
	if cfg["apiKey"].(string) != "sk-test-123" {
		t.Fatalf("expected apiKey sk-test-123, got %v", cfg["apiKey"])
	}

	st, data = tc.doJSON(t, "GET", "/api/usage/today", tok, nil)
	if st != 200 {
		t.Fatalf("usage expected 200, got %d", st)
	}
	if u := asObj(t, data); u["quota"].(float64) <= 0 {
		t.Fatalf("quota should be positive, got %v", u["quota"])
	}
}

// asArr 断言数据是数组。
func asArr(t *testing.T, data any) []any {
	t.Helper()
	arr, _ := data.([]any)
	return arr
}