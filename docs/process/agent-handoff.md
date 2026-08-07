# Agent Handoff

Last updated: 2026-06-08

## 最新用户要求

- 前端重构为 Kumo。
- 数据库使用 SQLite。
- 支持多用户。
- 提供完善后台管理能力。
- 后端其它部分可自行分析优化，必要时可重写。
- 过程文档和 PRD 必须齐全，方便其它 agent 无缝接手。
- 最新追加：全站可见文案都要中文，所有可见组件都要用 Kumo。

## 规范文档

- `AGENTS.md`
- `CONTEXT.md`
- `docs/prd/kumo-sqlite-multiuser-admin.md`
- `docs/process/rewrite-plan.md`
- `docs/adr/0001-node-hono-sqlite-primary-runtime.md`
- `.scratch/kumo-sqlite-multiuser-admin/PRD.md`

## Kumo 参考资料

本地参考目录：

`E:/Code/kumo资料/`

关键事实：

- 包名：`@cloudflare/kumo`
- 当前本地参考版本：`2.5.0`
- 推荐导入：`import { Button, Input, Dialog } from "@cloudflare/kumo"`
- CSS 顺序必须是：

```css
@source "../node_modules/@cloudflare/kumo/dist/**/*.{js,jsx,ts,tsx}";
@import "@cloudflare/kumo/styles";
@import "tailwindcss";
```

- Kumo 推荐图标库为 `@phosphor-icons/react`。

## 当前架构决策

Node/Hono + SQLite 是主运行时。Cloudflare Pages Functions 仍作为兼容适配代码存在，但多用户持久化、权限、后台管理、AI 用量和审计应以 Node/Hono 模块为准。

前端采用两层迁移方式：

- 新页面直接使用 `@cloudflare/kumo`。
- 旧编辑器区域继续从 `src/components/ui` 导入，但这些 wrappers 已改为 Kumo-backed，不再直接使用 Radix/lucide。

隐藏文件选择 input 是保留例外，因为它不是可见展示组件。

## 已完成的主要工作

- SQLite schema 覆盖 users、projects、versions、settings、ai_usage、audit_logs。
- Go 后端（`backend/`）导出并存取这些领域模块，chi 路由 + `modernc.org/sqlite`。
- Node/Hono TS 后端（原 `server/`、`server.ts`）已从仓库移除，统一由 Go 后端提供 API。
- 认证支持注册、登录、`/me`、首个管理员、成员默认角色、停用状态。
- 项目和版本 API 强制 owner scope。
- 后台 API 位于 `/api/admin`，包含 stats、users、projects、settings、usage、audit。
- AI chat route 加入服务端用量中间件。
- Kumo shell、认证页、项目页、后台页、个人设置页已接入。
- `src/components/ui` 下的 Button、Input、Textarea、Loading、Card、Dialog、Dropdown、Tooltip、Toast、Toaster 已是 Kumo-backed。
- 可见原生 `<button>` 和 `<textarea>` 已替换为 Kumo 或兼容层；只剩隐藏文件 input。
- 全站可见文案已做中文化第一轮；后端常见错误也已中文化。
- 显式移除了 `lucide-react` 和旧 Radix 组件包直接依赖。
- 已修复项目页闪烁：`useToast()` 现在返回稳定回调，避免 `ProjectsPage` 的 `loadProjects` effect 因依赖变化反复触发；`App` 也移除了路由级强制重挂。
- 已修复首页样式混搭：`HomePage` 的主输入区、快捷入口和最近项目切到 Kumo token / `LayerCard` / Kumo-backed 组件，宽屏下无横向溢出。
- 已修复卡片型 Kumo Button 尺寸冲突：`HomePage` 快捷入口/最近项目、`ProjectsPage` 新建卡片/项目缩略图、导入文件卡片均显式撑满网格，项目缩略图不再被普通按钮高度压缩导致标题区重叠。
- 已删除未使用的旧 `MainLayout` / `AppSidebar` / `PWAInstallButton` / `PageTransition`，`src/components/layout` 仅继续导出当前仍使用的项目创建/导入弹窗。
- 已收敛 `src/index.css`：保留 Kumo CSS 顺序和基础 body/root 样式，移除旧自定义主题 token 与全局隐藏滚动条规则。
- 已修复本地开发协作 WebSocket 代理：`vite.config.ts` 的 `/api` proxy 已开启 `ws: true`，临时 5175 Vite smoke 验证 `ws://127.0.0.1:5175/api/collab?...` 可打开。
- 已修复后台和设置页的可见英文值：后台用户表 Select 现在显示“管理员/成员”和“启用/已停用”，后台审计 metadata 将 `engineType` 显示为“绘图引擎”，设置页服务商 Select 显示“OpenAI 兼容接口”。
- 已将 Excalidraw 组件传入 `langCode="zh-CN"`，第三方编辑器内置工具栏从 `Shapes` 切换为“形状”。
- 已优化移动端首页和项目页视觉密度：`KumoAppShell` 在窄屏把登录入口放到品牌行右侧，导航保留为第二行；`HomePage` 输入区底部工具栏在移动端使用 2 列辅助操作、全宽引擎选择和全宽发送按钮，避免“发送”孤立换行。
- 已修复编辑器协作连接和浮层问题：`useCollab` 不再随 render 重建 WebSocket，开发模式直连 8787 后端；Mermaid 工具栏在窄屏自动换行；源码面板与版本历史互斥，避免两个浮层叠在一起。

## 当前验证状态

已通过：

```powershell
node_modules\.bin\tsc -b
node_modules\.bin\eslint .
corepack pnpm run test:backend
node_modules\.bin\vite build
```

浏览器 smoke 已覆盖：

- `http://127.0.0.1:5174/`
- `/auth`
- `/projects`
- `/admin`
- 首页、登录、项目和后台权限页均能中文渲染。
- `/projects` 在 1.2 秒后稳定显示空态或项目列表，不再持续 spinner。
- 首页已在默认视口、2048×1000 宽屏和 390×844 移动视口回归，Kumo shell 与首页布局无横向溢出。
- `/projects` 已在默认视口、2048×1000 宽屏和 390×844 移动视口回归，项目卡片网格、缩略图、标题区无重叠。
- 本轮追加真实 Chrome 复核：524/528px 窄屏下首页与项目页 `scrollWidth == clientWidth`；项目页空状态和新建项目后的卡片状态均不再闪烁，缩略图按钮与标题区保持分离；测试项目已通过中文确认弹窗删除并清理。
- 追加复测：真实 Chrome 530/532px 窄屏下首页无横向溢出；项目页 25 次、约 3 秒连续采样均无加载态回弹，`scrollWidth == clientWidth`；临时 `codex-ui-smoke-*` 项目卡片缩略图、标题、标签和操作按钮无重叠，测试项目已通过服务端删除接口清理。
- 项目页重载后控制台 error 日志为 0；本轮证据截图保存在 `C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-home-524.png`、`C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-projects-526.png`、`C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-projects-card-528.png`、`C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-real-home.png`、`C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-real-projects.png`、`C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-real-project-card.png`。
- `/admin` 在未登录或非管理员状态下显示中文权限提示并跳转到 `/auth`，符合预期。
- `/admin` 管理员真实页面已覆盖概览、用户、项目、设置、用量、审计 tab；528px 窄屏下页面无外层横向溢出，用户表 Select、设置键前缀和审计详情均为中文语义。
- `/editor/:projectId` 已通过项目页真实点击进入，header 固定在视口顶部，`scrollWidth == clientWidth`。
- 已覆盖导入文本项目、打开 Mermaid 编辑器渲染、重命名项目、删除项目；测试数据已清理。
- 已覆盖新建 Excalidraw 项目并打开编辑器，canvas 存在，内置工具栏中文化，测试数据已清理。
- 临时 dev proxy smoke 已验证 WebSocket 代理可连接；若继续使用已运行的 5174 旧进程，需重启前端 dev server 才会读取新的 `vite.config.ts`。
- 本轮追加复测 324/530/1280px 视口：临时 IndexedDB 注入 `codex-smoke-*` 项目后，首页和 `/projects` 连续 25 次采样无加载态回弹、无标题跳变、无控制台 error，`scrollWidth == clientWidth`；324px 截图确认移动端顶部外壳和首页发送按钮排版正常。新证据截图为 `C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-compact-home-324.png`、`C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-compact-projects-324.png`。
- 编辑器追加复测：`ws://127.0.0.1:8787/api/collab?projectId=codex-ws-smoke` 可连接；`/editor/:projectId` 在 1280/390/324px Mermaid 项目下无控制台 error、无横向溢出；324px 下 Mermaid 工具栏不再裁切右侧按钮，源码面板可打开，切换到版本历史后不再露出源码面板边缘。证据截图为 `C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-editor-324-after-toolbar.png`、`C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-editor-324-mutual-overlays.png`、`C:/Users/DSUK/AppData/Local/Temp/ai-draw-nexus-editor-clean-source-324.png`。

建议后续继续补充的浏览器 smoke：

- 深入验证保存版本、AI 生成入口和源码面板；当前仅做了编辑器打开与布局 smoke。

## 已知注意事项

- PowerShell `Get-Content` 可能把中文显示成 mojibake；不要仅凭该输出判断文件损坏。Node 以 UTF-8 读取正常。
- `pnpm-lock.yaml` 仍可能包含 Radix transitive entries，这是 Kumo 或其它包的依赖树；`package.json` 不再直接依赖旧 Radix/lucide。
- `rg '@/components/ui' src` 仍会命中旧编辑器区域，这是有意保留的 Kumo-backed 兼容层。
- `DrawioEditor.tsx` 里的 `dark: systemTheme === 'dark'` 是 Draw.io 配置对象，不是 Tailwind `dark:` 变体。
- 本地开发时协作 WebSocket 依赖 Vite `ws: true` 代理；配置已改，但已启动的 dev server 需要重启后生效。
- 5173 端口可能属于其它仓库；本项目 smoke 若需启动前端，优先使用 5174 或空闲端口。

## 下一位 agent 的建议入口

1. 先跑最终验证命令，记录失败项。
2. 若构建失败，优先检查最近的 Kumo Button/Textarea 兼容层改动。
3. 若项目页再次闪烁，优先检查 hook 返回值是否被 effect/useCallback 作为不稳定依赖。
4. 通过浏览器 smoke 检查中文和 Kumo 组件渲染。
5. 若继续深化，优先补后端 AI 用量、协作隔离和后台权限测试。

## Suggested Skills

- `diagnose`：构建、测试或浏览器 smoke 失败时使用。
- `to-issues`：需要把后续深化拆成可并行任务时使用。
- `handoff`：切换会话前继续更新本文件，并另存临时 handoff。
- `browser:control-in-app-browser`：验证本地前端页面和截图时使用。
