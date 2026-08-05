# PRD: Kumo + SQLite 多用户后台重构

Status: ready-for-agent
Last updated: 2026-06-08

## Problem Statement

AI Draw Nexus 已有 Mermaid、Draw.io、Excalidraw 等绘图能力，但产品基础设施还不能支撑真实的多用户工作区。旧实现同时存在 IndexedDB、本地 JSON fallback、SQLite、Cloudflare Pages Functions 和 Node/Hono 多条路径，权限、项目归属、版本持久化、额度、审计和后台管理都容易出现分歧。

用户要求将前端重构为 Kumo 风格与组件体系，数据库使用 SQLite，支持多用户，并提供完善的后台管理能力。最新补充要求是：全站可见文案必须为中文，所有可见 UI 组件必须使用 Kumo 或 Kumo-backed 兼容层。

## Solution

以 Node/Hono + SQLite 作为主运行时，保留现有绘图引擎，重构应用外壳、认证、项目持久化、后台管理、额度记录和交接文档。

第一阶段目标是交付一个可运行的 tracer-bullet 版本：

- Kumo 应用外壳、导航、页面、表单、弹窗、表格、提示与后台管理界面。
- SQLite schema 覆盖用户、角色、状态、项目、版本、设置、AI 用量和审计记录。
- JWT 登录态与服务端角色校验，首个注册用户自动成为管理员。
- 普通用户只能访问自己的项目与版本。
- `/api/admin` 提供用户、项目、设置、用量、审计和统计管理能力。
- 协作 WebSocket 按 `projectId` 隔离房间。
- 前端可见文案中文化，错误 toast 接收的后端消息也中文化。
- PRD、过程计划、ADR、handoff 文档齐全，便于其它 agent 无缝接手。

## User Stories

1. 作为访客，我想注册账号，以便将项目保存到工作区。
2. 作为访客，我想用用户名或邮箱登录，以便进入自己的绘图空间。
3. 作为第一个注册用户，我想自动获得管理员身份，以便初始化系统。
4. 作为普通用户，我想刷新页面后保留登录态，以便继续工作。
5. 作为普通用户，我想只看到自己的项目，以便保护其他用户的数据。
6. 作为普通用户，我想创建 Mermaid、Draw.io 或 Excalidraw 项目，以便选择合适的绘图引擎。
7. 作为普通用户，我想重命名和删除自己的项目，以便整理工作区。
8. 作为普通用户，我想项目版本保存到 SQLite，以便跨设备恢复。
9. 作为普通用户，我想打开项目时加载最新版本，以便继续上次的内容。
10. 作为普通用户，我想手动保存重要版本，以便回退历史。
11. 作为普通用户，我想自动保存编辑内容，以便降低丢失风险。
12. 作为普通用户，我想 AI 生成和重试结果写入版本记录，以便追踪变化。
13. 作为普通用户，我想协作消息只在当前项目内广播，以便避免串项目。
14. 作为普通用户，我想使用中文界面和中文错误提示，以便减少理解成本。
15. 作为普通用户，我想继续使用现有绘图引擎，以便迁移基础设施时不丢失核心能力。
16. 作为管理员，我想查看用户、项目、版本和 AI 请求统计，以便判断系统运行情况。
17. 作为管理员，我想创建用户，以便协助团队成员开通账号。
18. 作为管理员，我想调整用户角色，以便授权其他管理员。
19. 作为管理员，我想停用或恢复用户，以便处理误用或滥用。
20. 作为管理员，我想避免停用最后一个启用管理员，以便系统不会失去管理入口。
21. 作为管理员，我想查看所有项目列表，以便审计工作区内容。
22. 作为管理员，我想查看与更新系统设置，以便控制注册、额度和 AI 默认配置。
23. 作为管理员，我想查看 AI 用量记录，以便审计成本和调用频率。
24. 作为管理员，我想查看审计日志，以便追踪敏感操作。
25. 作为部署者，我想有唯一主运行时说明，以便避免本地和生产行为漂移。
26. 作为后续 agent，我想看到完整 PRD、过程文档和已知 caveat，以便不重新梳理上下文。

## Implementation Decisions

- 主运行时是 Node/Hono；SQLite 通过 `better-sqlite3` 访问。
- SQLite 初始化由 Node 启动流程负责，schema 文件是数据库结构的来源。
- 原 JSON mock fallback 不再作为核心数据路径。
- 用户表包含 `username`、`email`、`password_hash`、`name`、`role`、`status` 和时间戳。
- 密码使用 PBKDF2 + 随机 salt；旧 SHA256 hash 在登录时迁移。
- JWT payload 包含 `userId`、`username`、`name`、`role`。
- 注册规则：首个用户为 `admin`，后续用户为 `member`；停用用户不能登录。
- 认证中间件负责登录态校验，管理员中间件负责服务端角色校验。
- 普通项目和版本 API 保持在 `/api/projects` 与 `/api/versions`，SQL 中强制 owner scope。
- 后台 API 统一挂在 `/api/admin`，提供 stats、users、projects、settings、usage、audit。
- 管理员项目列表第一阶段为只读；破坏性跨用户项目操作需另加审计后再实现。
- AI 用量记录为 append-only，登录用户受服务端日额度约束。
- 访问密码或自定义 LLM 配置可标记为豁免，但仍记录调用上下文。
- 审计记录为 append-only，记录认证、后台、项目和设置操作。
- 协作房间以 `projectId` 为 key，禁止全局广播。
- Cloudflare Pages Functions 保留为兼容适配代码，但不是多用户持久化和后台权限的来源。
- 全站可见文案使用中文；OpenAI、Anthropic、SQLite、Kumo、Mermaid、Draw.io、Excalidraw、XML、JSON、API、LLM 等技术名可保留原文。
- 新页面优先直接使用 `@cloudflare/kumo`；编辑器旧区域通过 `src/components/ui` 的 Kumo-backed 兼容层迁移。
- 可见 Button、Input、Textarea、Dialog、Dropdown、Tooltip、Toast、Card/LayerCard 等组件必须来自 Kumo 或兼容层。
- 隐藏文件选择 input 可保留原生元素，因为它不是展示组件。
- 图标使用 Kumo 推荐的 `@phosphor-icons/react`；不再直接依赖 `lucide-react` 或旧 Radix 组件包。
- Kumo CSS 顺序固定为 `@source`、`@import "@cloudflare/kumo/styles"`、`@import "tailwindcss"`。

## Testing Decisions

- 好测试应验证外部行为，不依赖实现细节。
- 后端测试使用临时 `DATABASE_PATH`，覆盖 schema 初始化、首个管理员、成员注册、登录、停用用户、管理员权限、项目 owner scope。
- 项目和版本测试应证明用户不能读取或修改其他用户数据。
- 后台测试应证明成员访问 `/api/admin/*` 得到 403，管理员可获取统计与列表。
- AI 用量测试应覆盖服务端额度、豁免标记和记录写入。
- 协作测试应覆盖不同 `projectId` 的消息隔离。
- 当前前端尚未引入专门测试框架；第一阶段以 `tsc -b`、`vite build`、浏览器 smoke 测试验证。
- 中文化验证可通过 AST/rg 扫描可见 JSX 文本、placeholder、title、toast 字符串，并人工确认技术名例外。

## Out of Scope

- 重写 Mermaid、Draw.io、Excalidraw 引擎本身。
- 组织/团队空间、共享项目 ACL 和细粒度权限。
- 计费系统。
- 完整 Cloudflare D1/Pages 生产等价实现。
- 从本地 IndexedDB 到云端的复杂迁移向导；当前只保留已有同步路径。
- 管理员跨用户删除项目；需要独立审计和确认流后再做。

## Further Notes

当前实现采用“直接 Kumo 页面 + Kumo-backed 旧兼容层”的迁移方式，目的是先稳定交付多用户、SQLite 和后台能力，再逐步清理编辑器内部旧布局。后续 agent 如果继续深化，应优先补后台/协作/AI 用量测试和浏览器 smoke，而不是重新选择运行时。
