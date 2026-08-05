# 外部 API 与 MCP 接入

AI Draw Nexus 提供两种供外部 AI 工具（opencode、Claude Code、Codex 等）调用的接口：

1. **REST API**（`/api/v1`）—— 基于 JWT Bearer 认证，任意 HTTP 客户端可用。
2. **MCP Server**（Streamable HTTP `/mcp`）—— 在线接入，与前端同一地址，JWT Bearer 认证。
3. **MCP Server**（stdio）—— 同机直连 SQLite，适合 Docker 卷内进程或本机开发。

## AI 系统提示词（外链）

系统已生成一份完整的功能说明（REST 端点、MCP 工具、引擎格式、使用建议），存放于：

```
GET /ai-prompt.txt
```

返回纯文本，不含任何令牌，可安全共享。AI 工具可自动读取该链接（curl / webfetch）后按说明操作工作区。设置页「AI 接入提示词」提供该链接与极简引导提示词的一键复制。

## 认证（REST API）

```bash
# 1. 登录获取会话 token
curl -X POST https://your-host/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"你的用户名","password":"你的密码"}'
# => { "user": {...}, "token": "eyJhbGci..." }

# 2. 生成独立的 API 访问令牌（推荐给 AI/脚本长期使用，可撤销）
curl -X POST https://your-host/api/auth/api-token \
  -H "Authorization: Bearer <登录token>" -H "Content-Type: application/json" \
  -d '{"name":"claude-code","expires_in_days":0}'   # expires_in_days: 0/省略=永久，>0=有效期天数
# => { "token": "...", "token_id": "...", "expires_at": null }

# 3. 管理令牌（轮转：列出 / 撤销）
curl https://your-host/api/auth/api-tokens -H "Authorization: Bearer <登录token>"   # 列出
curl -X DELETE https://your-host/api/auth/api-tokens/<token_id> \
  -H "Authorization: Bearer <登录token>"                                          # 撤销

# 4. 调用 API
curl https://your-host/api/v1/projects \
  -H "Authorization: Bearer <api-token>"
```

API 令牌持久化存储（仅存哈希），**撤销后立即失效**，适合轮转：定期签发新令牌、撤销旧令牌。登录会话 token 7 天有效且不含 jti，不受 API 令牌撤销影响。

## REST API 端点

所有端点均需 `Authorization: Bearer <token>`，响应统一为 `{ "data": ... }` 或 `{ "error": "..." }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/projects` | 列出项目 |
| POST | `/api/v1/projects` | 创建项目 `{ title, engine_type }` |
| GET | `/api/v1/projects/:id` | 项目详情（含最新内容） |
| PATCH | `/api/v1/projects/:id` | 修改标题 `{ title }` |
| DELETE | `/api/v1/projects/:id` | 删除项目 |
| GET | `/api/v1/projects/:id/content` | 读取当前图表源码 |
| PUT | `/api/v1/projects/:id/content` | 保存内容为新版本 `{ content, change_summary? }` |
| GET | `/api/v1/projects/:id/versions` | 版本列表（不含内容） |
| GET | `/api/v1/versions/:id` | 版本详情（含内容） |
| POST | `/api/v1/generate` | AI 生成/修改图表 `{ prompt, engine_type?, current_content? }`（非流式） |
| GET | `/api/v1/engines` | 可用引擎列表 |
| POST | `/api/v1/files` | 上传图表文件（multipart/form-data，字段 `file`），导入为新项目 |

`engine_type` 取值：`drawio` / `excalidraw` / `mermaid`（默认 `drawio`）。

### 文件上传导入

上传 `.mmd/.mermaid/.excalidraw/.drawio/.xml/.json/.txt` 文件，服务器解析内容、自动推断引擎并创建项目（含首个版本），返回项目 ID：

```bash
curl -X POST https://your-host/api/v1/files \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@流程.mmd"
# => { "data": { "project_id": "...", "title": "流程", "engine_type": "mermaid", "version_id": "...", "bytes": 74 } }
```

支持扩展名：`.mmd` / `.mermaid` / `.excalidraw` / `.drawio` / `.xml` / `.json` / `.txt`；其他类型返回 415。最大 20MB。

### 示例：生成并保存图表

```bash
# 1. 生成（mermaid 流程图）
curl -X POST https://your-host/api/v1/generate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"prompt":"绘制登录流程时序图","engine_type":"mermaid"}'

# 2. 创建项目
curl -X POST https://your-host/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"登录流程","engine_type":"mermaid"}'

# 3. 保存内容（写入版本历史）
curl -X PUT https://your-host/api/v1/projects/<ID>/content \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"graph TD;\\n  A --> B;","change_summary":"初始生成"}'
```

## MCP Server（HTTP）

在线模式，通过 Streamable HTTP 提供，与前端同域：

```
POST https://your-host/mcp
Authorization: Bearer <token>
```

认证令牌与 REST API 相同（登录接口下发，7 天有效），每个请求都必须携带。工具列表与 stdio 版一致。

`generate_diagram` 默认会**自动保存为新项目**并返回 `editor_url`（打开后可在编辑器导出 PNG/SVG；首次打开自动生成项目缩略图）。传入 `project_id` 时更新该项目；`save: false` 时仅返回生成内容、不落库。HTTP 模式下 `editor_url` 自动使用请求 Host（部署在 HTTPS 反代后返回 `https://...`）；stdio 模式需设置 `PUBLIC_BASE_URL`。

### Claude Code 配置示例

`.mcp.json`（项目根目录）或 Claude Desktop 配置：

```json
{
  "mcpServers": {
    "ai-draw-nexus": {
      "type": "http",
      "url": "https://your-host/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

### opencode 配置示例

`opencode.json`：

```json
{
  "mcp": {
    "ai-draw-nexus": {
      "type": "remote",
      "url": "https://your-host/mcp",
      "headers": { "Authorization": "Bearer <token>" },
      "enabled": true
    }
  }
}
```

令牌在设置页自动复制：`设置 → 开发者 API → MCP Server` 中的配置已内嵌当前令牌，复制即用。令牌过期后回到该页重新复制即可。

## MCP Server（stdio）

同机 stdio 模式，直连 SQLite（适合 Docker 卷内进程或本机开发）。

```bash
npm run mcp
# 等价：tsx server/mcp.ts
```

环境变量：

- `MCP_USERNAME` —— 操作归属的用户名（必填建议）。未设置时回退到最早注册的用户。

注意：MCP 以 stdio 输出 JSON-RPC，请勿在启动命令中混入会向 stdout 打印内容的包装脚本。

### 工具列表（HTTP 与 stdio 通用）

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `list_projects` | — | 列出项目 |
| `create_project` | `title`, `engine_type` | 创建项目 |
| `get_project` | `id` | 项目详情 + 最新内容 |
| `get_project_content` | `id` | 读取图表源码 |
| `update_project_content` | `id`, `content`, `change_summary?` | 保存为新版本 |
| `list_versions` | `id` | 版本列表 |
| `get_version` | `id` | 版本内容 |
| `generate_diagram` | `prompt`, `engine_type?`, `project_id?`, `title?`, `save?` | AI 生成/修改；默认保存为项目并返回 `editor_url`（`save:false` 仅生成） |
| `import_diagram` | `filename`, `content`, `title?`, `engine_type?` | 导入图表文件为新项目（支持 .mmd/.mermaid/.excalidraw/.drawio/.xml，引擎自动推断） |

## 旧版 stdio 配置（已不推荐）

以下为早期 stdio 配置，仅适用于与服务器同机的场景：

```json
{
  "mcpServers": {
    "ai-draw-nexus": {
      "command": "npx",
      "args": ["tsx", "server/mcp.ts"],
      "env": { "MCP_USERNAME": "salen" }
    }
  }
}
```
