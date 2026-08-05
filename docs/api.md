# 外部 API 与 MCP 接入

AI Draw Nexus 提供两种供外部 AI 工具（opencode、Claude Code、Codex 等）调用的接口：

1. **REST API**（`/api/v1`）—— 基于 JWT Bearer 认证，任意 HTTP 客户端可用。
2. **MCP Server**（stdio）—— Claude Code / opencode 原生集成，同机直连 SQLite。

## 认证（REST API）

```bash
# 1. 登录获取 token
curl -X POST https://your-host/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"你的用户名","password":"你的密码"}'
# => { "user": {...}, "token": "eyJhbGci..." }

# 2. 调用 API
curl https://your-host/api/v1/projects \
  -H "Authorization: Bearer eyJhbGci..."
```

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

`engine_type` 取值：`drawio` / `excalidraw` / `mermaid`（默认 `drawio`）。

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

## MCP Server

同机 stdio 模式，直连 SQLite（适合 Docker 卷内进程或本机开发）。

```bash
npm run mcp
# 等价：tsx server/mcp.ts
```

环境变量：

- `MCP_USERNAME` —— 操作归属的用户名（必填建议）。未设置时回退到最早注册的用户。

### 工具列表

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `list_projects` | — | 列出项目 |
| `create_project` | `title`, `engine_type` | 创建项目 |
| `get_project` | `id` | 项目详情 + 最新内容 |
| `get_project_content` | `id` | 读取图表源码 |
| `update_project_content` | `id`, `content`, `change_summary?` | 保存为新版本 |
| `list_versions` | `id` | 版本列表 |
| `get_version` | `id` | 版本内容 |
| `generate_diagram` | `prompt`, `engine_type?`, `project_id?` | AI 生成/修改（提供 `project_id` 时基于当前内容修改） |

### Claude Code 配置示例

`.mcp.json`（项目根目录）或 Claude Desktop 配置：

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

### opencode 配置示例

`opencode.json`：

```json
{
  "mcp": {
    "ai-draw-nexus": {
      "type": "local",
      "command": ["npx", "tsx", "server/mcp.ts"],
      "enabled": true
    }
  }
}
```

注意：MCP 以 stdio 输出 JSON-RPC，请勿在启动命令中混入会向 stdout 打印内容的包装脚本。
