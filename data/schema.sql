CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  engine_type TEXT NOT NULL CHECK (engine_type IN ('drawio', 'excalidraw', 'mermaid')),
  thumbnail TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'workspace')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  created_by TEXT,
  content TEXT NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('pending', 'streaming', 'complete', 'error')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  provider TEXT NOT NULL,
  model_id TEXT,
  request_kind TEXT NOT NULL DEFAULT 'chat',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  exempt INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  jti TEXT NOT NULL UNIQUE,
  expires_at DATETIME,
  last_used_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS generate_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  engine_type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')),
  content TEXT NOT NULL DEFAULT '',
  error_msg TEXT NOT NULL DEFAULT '',
  change_summary TEXT NOT NULL DEFAULT 'AI 生成',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  finished_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at);
CREATE INDEX IF NOT EXISTS idx_versions_project_id ON versions(project_id);
CREATE INDEX IF NOT EXISTS idx_versions_timestamp ON versions(timestamp);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_id ON ai_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_project ON chat_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_jti ON api_tokens(jti);
CREATE INDEX IF NOT EXISTS idx_generate_tasks_user ON generate_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_generate_tasks_project ON generate_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_generate_tasks_status ON generate_tasks(status);
