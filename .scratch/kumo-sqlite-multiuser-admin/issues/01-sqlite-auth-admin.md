# SQLite 认证与后台基础

Status: ready-for-agent

Implementation state: current worktree contains the first implementation; rerun verification before closing.

## Goal

用 SQLite-backed auth、角色、后台路由、用量记录和审计记录替换脆弱持久化。

## Acceptance Criteria

- SQLite 从 `db/schema.sql` 初始化。
- 首个注册用户成为 `admin`。
- 后续用户成为 `member`。
- 停用用户不能登录。
- JWT 包含角色。
- 成员访问 `/api/admin/*` 返回 403。
- 管理员可查看统计、用户、项目、设置、用量和审计记录。
