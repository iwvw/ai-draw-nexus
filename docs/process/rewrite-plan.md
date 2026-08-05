# Rewrite Plan: Kumo + SQLite + 多用户后台

Status: active
Last updated: 2026-06-08

## 目标

- 前端统一到 Kumo 组件体系，页面可见文案全部中文。
- SQLite 成为登录用户项目、版本、后台数据的事实来源。
- 支持多用户认证、角色、用户状态和 owner-scoped 项目访问。
- 提供后台管理：统计、用户、项目、设置、AI 用量、审计。
- 保留 Mermaid、Draw.io、Excalidraw 绘图引擎，避免基础设施重构时改坏核心绘图能力。
- 保持 PRD、过程计划、ADR、交接文档可读可接手。

## 已识别的旧架构问题

1. 根数据库模块在 ESM 项目里混用 CommonJS `require`，并静默回退到 JSON。
2. schema 与 auth route 曾经在 `username` / `email` 语义上漂移。
3. Cloudflare Pages Functions 与 Node/Hono route 行为不一致。
4. 协作广播曾经是全局广播，不按项目隔离。
5. AI 额度主要在浏览器端，容易绕过。
6. 后台管理缺失，无法管理用户、设置、用量和审计。
7. 前端曾混用本地设计 wrappers、Radix/lucide 依赖和部分乱码文案。

## 目标模块

### SQLite 模块

职责：

- 启动时初始化 schema。
- 暴露适合 prepared statement 的数据库访问。
- seed 系统设置，并确保旧数据首个用户可提升为管理员。

关键文件：

- `server/db/sqlite.ts`
- `data/schema.sql`

### 认证与权限模块

职责：

- 注册、登录、token 生成与校验。
- 首个用户自动成为管理员。
- 停用用户禁止登录和访问。
- 服务端强制 `requireAuth` 与 `requireAdmin`。

关键文件：

- `server/auth-utils.ts`
- `server/middleware/auth.ts`
- `server/routes/auth.ts`

### 工作区数据模块

职责：

- 普通用户项目与版本 owner scope。
- 管理员统计、用户、项目、设置、AI 用量、审计。
- 审计写入与 AI 用量记录。

关键文件：

- `server/routes/projects.ts`
- `server/routes/versions.ts`
- `server/routes/admin.ts`
- `server/middleware/ai-usage.ts`
- `server/db/audit.ts`

### Kumo 前端模块

职责：

- Kumo 应用外壳。
- 中文页面、导航、后台、表单、弹窗、toast。
- 旧编辑器区域通过 Kumo-backed 兼容层继续运行。

关键文件：

- `src/components/kumo/KumoAppShell.tsx`
- `src/components/ui/*`
- `src/pages/AdminPage.tsx`
- `src/pages/AuthPage.tsx`
- `src/pages/ProjectsPage.tsx`
- `src/pages/ProfilePage.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/EditorPage.tsx`

## 执行顺序与状态

1. 完成协调文档、PRD、ADR、handoff。状态：已建立，当前正在更新收口。
2. 替换 SQLite 模块与 schema。状态：已完成。
3. 更新认证：用户名/邮箱、角色、状态、首个管理员。状态：已完成。
4. 添加认证和管理员中间件。状态：已完成。
5. 添加后台管理 API。状态：已完成。
6. 协作房间按 `projectId` 隔离。状态：已完成。
7. 接入 Kumo 依赖与 CSS 顺序。状态：已完成。
8. 添加 Kumo shell、认证页、项目页、后台页、个人设置页。状态：已完成。
9. 将旧 `src/components/ui` 改为 Kumo-backed 兼容层。状态：已完成。
10. 将可见原生按钮、输入框、文本框替换为 Kumo 或 Kumo-backed 组件。状态：已完成；隐藏文件 input 保留。
11. 全站可见文案中文化，服务端常见错误中文化。状态：已完成第一轮扫描。
12. 运行类型检查、构建、后端测试、浏览器 smoke。状态：已完成，详见当前验证状态。
13. 修复项目页闪烁和首页样式混搭。状态：已完成；根因是 toast hook 返回不稳定回调触发项目页 effect 循环，首页已切到 Kumo token 与 Kumo-backed 组件布局。
14. 修复卡片型 Kumo Button 默认尺寸与网格卡片冲突。状态：已完成；首页快捷入口、最近项目、项目页新建卡片、项目缩略图和导入文件卡片均已补齐全宽/自适应高度约束。
15. 清理旧布局残留与开发协作代理。状态：已完成；删除未使用旧 layout 文件，收敛全局 CSS，Vite `/api` proxy 开启 `ws: true`。
16. 修复后台、设置页和 Excalidraw 的可见英文漏项。状态：已完成；后台用户 Select、审计 metadata、设置页服务商 Select、设置键前缀和 Excalidraw 内置工具栏已中文化或加中文语义。
17. 优化首页和项目页移动端视觉密度。状态：已完成；移动端 Kumo shell 将登录入口收进品牌行，首页输入区工具栏改为 2 列辅助操作、全宽引擎选择和全宽发送按钮，避免窄屏按钮孤立换行。
18. 修复编辑器协作与浮层小屏问题。状态：已完成；`useCollab` 按 `projectId` 建立稳定连接，开发环境直连 8787，避免旧 Vite 进程代理未刷新时控制台刷 WebSocket error；Mermaid 工具栏窄屏换行；源码面板与版本历史互斥，避免浮层叠边。
19. 目录结构收口。状态：已完成；运行数据统一到 `data/`（`data/nexus.db` + `data/schema.sql`），删除根 `db.ts` 与整个 `functions/` 兼容层（AI 聊天、模型列表、URL 解析、SSE 流式逻辑迁入 `server/ai/*` 与 `server/routes/*`），`ProjectRepository`/`VersionRepository` 改名 `ProjectService`/`VersionService`，清理 PWA 安装钩子、模板与旧静态资源，Dockerfile/compose/.gitignore/.env.example 同步更新。

## 当前验证命令

已通过：

```powershell
node_modules\.bin\tsc -b
node_modules\.bin\eslint .
corepack pnpm run test:backend
node_modules\.bin\vite build
git diff --check
```

说明：

- `pnpm` 在当前环境可能受 Corepack 影响，优先使用 `corepack pnpm`。
- Vite build 仍有非阻塞警告：Mermaid 同时动态/静态导入、部分 chunk 超过 500 kB、Browserslist/caniuse-lite 数据偏旧。
- 浏览器 smoke 使用 8787/5174；5173 可能属于其它仓库，避免占用。
- 已回归 `/projects` 不再持续 spinner，首页和项目页在默认视口、2048×1000 宽屏、390×844 移动视口无横向溢出。
- 本轮追加真实 Chrome 复核：524/528px 窄屏下首页、项目页空状态、项目页新建项目后的卡片状态均稳定；项目卡片缩略图和标题区无重叠；测试项目已通过中文确认弹窗删除清理；项目页重载后控制台 error 为 0。
- 追加复测：真实 Chrome 530/532px 窄屏下首页无横向溢出；项目页 25 次、约 3 秒连续采样均无加载态回弹，`scrollWidth == clientWidth`；临时 `codex-ui-smoke-*` 项目卡片缩略图、标题、标签和操作按钮无重叠，测试项目已通过服务端删除接口清理。
- 已覆盖 `/admin` 管理员真实页面的概览、用户、项目、设置、用量、审计 tab；528px 窄屏下无外层横向溢出。
- 已覆盖导入文本项目、Mermaid 编辑器渲染、重命名、删除，以及 Excalidraw 新建打开；测试项目均已清理。
- 已通过项目页真实点击打开 `/editor/:projectId`，编辑器 header 保持在视口顶部且无横向溢出。
- 已用临时 5175 Vite 实例验证 `/api/collab` WebSocket 代理可连接；已有 5174 dev server 需重启后读取新代理配置。
- 本轮继续复测 324/530/1280px 视口：有项目状态下首页和 `/projects` 连续 25 次采样无加载态回弹、无标题跳变、无控制台 error，`scrollWidth == clientWidth`；324px 截图确认首页发送按钮全宽、顶部导航压缩后无挤压，证据截图为 `C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-compact-home-324.png` 与 `C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-compact-projects-324.png`。
- 编辑器追加复测：`ws://127.0.0.1:8787/api/collab?projectId=codex-ws-smoke` 可连接；`/editor/:projectId` 在 1280/390/324px 下打开 Mermaid 项目无控制台 error、无页面横向溢出；324px 下 Mermaid 工具栏不再裁切右侧按钮，源码与版本历史切换后不再互相露边。证据截图为 `C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-editor-324-after-toolbar.png`、`C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-editor-324-mutual-overlays.png`、`C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-editor-clean-source-324.png`。

## 不可回退项

- 不要把核心持久化重新接回 JSON mock fallback。
- 不要只依赖前端隐藏后台入口；管理员权限必须由服务端校验。
- 不要把协作消息广播到全局。
- 不要在审计记录里存明文密码、访问密码或 API key。
- 不要重新引入 `lucide-react` 或旧 Radix 组件作为直接依赖。
- 不要新增英文 UI 文案；技术名例外需保持克制。
- 不要删除绘图引擎代码，除非同一切片提供等价替代。

## 后续深化建议

- 补充 AI 用量中间件测试和协作房间隔离测试。
- 为后台用户管理添加更细的端到端 smoke。
- 将编辑器旧布局逐步迁移到直接 Kumo 组件，减少兼容层面积。
- 设计管理员跨用户项目操作时，先写 ADR 与审计策略。
- 明确 Cloudflare Pages/D1 的后续部署策略，避免继续与 Node/Hono 主运行时漂移。
