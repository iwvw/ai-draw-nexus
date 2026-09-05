// Package db 测试：验证生成任务的原子持久化（版本 + 用户/助手聊天消息 + 任务状态）。
package db

import (
	"path/filepath"
	"strings"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"), schemaForTest())
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := s.Init(); err != nil {
		t.Fatalf("init db: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func schemaForTest() string {
	return filepath.Join("..", "..", "..", "data", "schema.sql")
}

func TestCompleteGenerationCreatesUserAndAssistantMessages(t *testing.T) {
	s := newTestStore(t)

	u, err := s.CreateUser("alpha", "", hashForTest(), "alpha", "")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	projectID := "proj-atomic-1"
	if err := s.CreateProject(projectID, u.ID, "原子生成项目", "drawio", ""); err != nil {
		t.Fatalf("create project: %v", err)
	}
	taskID, err := s.CreateGenerateTask(u.ID, projectID, "drawio", "画一张图", "AI 生成")
	if err != nil {
		t.Fatalf("create task: %v", err)
	}

	display := "帮我画一个流程图"
	err = s.CompleteGeneration(taskID, projectID, u.ID, display, `[{"type":"document","fileName":"a.txt"}]`, "<xml/>", "AI 生成")
	if err != nil {
		t.Fatalf("complete generation: %v", err)
	}

	msgs, err := s.ListChatMessages(projectID)
	if err != nil {
		t.Fatalf("list chat: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("expected 2 chat messages, got %d", len(msgs))
	}
	if msgs[0].Role != "user" || msgs[0].Content != display {
		t.Fatalf("first message should be user with display prompt, got role=%s content=%q", msgs[0].Role, msgs[0].Content)
	}
	if !strings.Contains(msgs[0].Attachments, "a.txt") {
		t.Fatalf("user message should carry attachments, got %q", msgs[0].Attachments)
	}
	if msgs[1].Role != "assistant" || msgs[1].Content != "<xml/>" {
		t.Fatalf("second message should be assistant with result content, got role=%s content=%q", msgs[1].Role, msgs[1].Content)
	}

	// 任务应标记为 done 且带结果。
	task, err := s.GetGenerateTask(taskID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if task.Status != "done" || task.Content != "<xml/>" {
		t.Fatalf("expected task done with content, got status=%s content=%q", task.Status, task.Content)
	}

	// 版本应已插入。
	latest, err := s.LatestVersionOfProject(projectID)
	if err != nil || latest == nil {
		t.Fatalf("expected latest version, got %v err=%v", latest, err)
	}
	if latest.Content != "<xml/>" {
		t.Fatalf("version content mismatch: %q", latest.Content)
	}
}

func TestCompleteGenerationWithoutProjectSkipsPersistence(t *testing.T) {
	s := newTestStore(t)

	u, err := s.CreateUser("beta", "", hashForTest(), "beta", "")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	taskID, err := s.CreateGenerateTask(u.ID, "", "mermaid", "仅生成", "AI 生成")
	if err != nil {
		t.Fatalf("create task: %v", err)
	}

	if err := s.CompleteGeneration(taskID, "", u.ID, "仅生成", "[]", "graph TD;A-->B", "AI 生成"); err != nil {
		t.Fatalf("complete generation without project: %v", err)
	}

	task, err := s.GetGenerateTask(taskID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if task.Status != "done" || task.Content != "graph TD;A-->B" {
		t.Fatalf("expected task done with content, got status=%s", task.Status)
	}
}

func hashForTest() string {
	const fake = "pbkdf2_sha256$120000$AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd$AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd"
	return fake
}