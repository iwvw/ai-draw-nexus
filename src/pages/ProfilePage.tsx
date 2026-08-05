import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Input, LayerCard, Meter, Select, SensitiveInput, Tabs } from '@cloudflare/kumo'
import {
  ArrowClockwiseIcon,
  CodeIcon,
  CopyIcon,
  CpuIcon,
  FloppyDiskIcon,
  GaugeIcon,
  GearSixIcon,
  KeyIcon,
  SignOutIcon,
  SparkleIcon,
  UserCircleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useToast } from '@/hooks/useToast'
import { aiService } from '@/services/aiService'
import { SettingsService, UsageService, type LlmConfig } from '@/services/settingsService'
import { useAuthStore } from '@/stores/authStore'

function defaultLlmConfig(): LlmConfig {
  return {
    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    modelId: '',
  }
}

const providerLabels: Record<string, string> = {
  openai: 'OpenAI 兼容接口',
  anthropic: 'Anthropic',
}

interface ApiTokenItem {
  id: string
  name: string
  expires_at: string | null
  last_used_at: string | null
  created_at: string
}

export function ProfilePage() {
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(defaultLlmConfig)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [quotaUsed, setQuotaUsed] = useState(0)
  const [quotaTotal, setQuotaTotal] = useState(10)
  const [apiTab, setApiTab] = useState('rest')
  const [apiTokens, setApiTokens] = useState<ApiTokenItem[]>([])

  const { success, error: showError } = useToast()
  const { user, isAuthenticated, logout, token } = useAuthStore()
  const navigate = useNavigate()

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      success(`${label}已复制`)
    } catch {
      showError('复制失败，请手动选择复制')
    }
  }

  const loadApiTokens = async () => {
    try {
      const res = await fetch('/api/auth/api-tokens')
      if (!res.ok) throw new Error('加载令牌列表失败')
      const json = (await res.json()) as { data: ApiTokenItem[] }
      setApiTokens(json.data)
    } catch (err) {
      showError(err instanceof Error ? err.message : '加载令牌列表失败')
    }
  }

  useEffect(() => {
    if (isAuthenticated) loadApiTokens()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  const handleGenerateApiToken = async () => {
    try {
      const res = await fetch('/api/auth/api-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '永久令牌', expires_in_days: 0 }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(json?.error || '生成令牌失败')
      }
      const json = (await res.json()) as { token: string }
      await copyText(json.token, 'API 令牌')
      success('已生成永久 API 令牌并复制')
      await loadApiTokens()
    } catch (err) {
      showError(err instanceof Error ? err.message : '生成令牌失败')
    }
  }

  const revokeApiToken = async (id: string) => {
    try {
      const res = await fetch(`/api/auth/api-tokens/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(json?.error || '撤销失败')
      }
      success('已撤销令牌')
      await loadApiTokens()
    } catch (err) {
      showError(err instanceof Error ? err.message : '撤销失败')
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  const restLoginExample = `# 登录（每次会话只需一次，获取 token）
curl -X POST ${origin}/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"username":"你的用户名","password":"你的密码"}'

# 返回 { "token": "..." }，之后调用：
curl ${origin}/api/v1/projects \\
  -H "Authorization: Bearer ${token ?? '<token>'}"`

  const mcpClaudeConfig = `{
  "mcpServers": {
    "ai-draw-nexus": {
      "type": "http",
      "url": "${origin}/mcp",
      "headers": { "Authorization": "Bearer ${token ?? '<token>'}" }
    }
  }
}`

  const mcpOpencodeConfig = `{
  "mcp": {
    "ai-draw-nexus": {
      "type": "remote",
      "url": "${origin}/mcp",
      "headers": { "Authorization": "Bearer ${token ?? '<token>'}" },
      "enabled": true
    }
  }
}`

  const aiSystemPrompt = `你是 AI Draw Nexus 的图表工作区外部接入助手。这是一个自托管的多用户在线绘图平台（Node/Hono + SQLite），支持 drawio、excalidraw、mermaid 三种图表引擎。你可以通过 REST API 或 MCP 工具为工作区用户创建、读取、修改、生成图表项目。

# 服务器地址
基础地址：${origin}
所有 API 都需要认证，使用请求头：Authorization: Bearer <token>

# 你的访问令牌
${token ? `Bearer ${token}` : '（未登录，先调用 POST /api/auth/login 获取 token）'}

# REST API（JSON 格式，响应统一为 { "data": ... } 或 { "error": "..." }）

## 认证
- POST /api/auth/login  body: {"username":"...","password":"..."}  → 返回 { user, token }（登录会话）
- POST /api/auth/api-token  body: {"expires_in_days": N}（N>0 指定有效期天数，0/省略=永久）→ 生成一个独立的 API 访问令牌（可随时撤销，适合给 AI/脚本长期使用）
- GET /api/auth/status  查看工作区状态（是否允许注册/公开访问）
- GET /api/auth/me      当前用户信息

## 项目与内容
- GET  /api/v1/projects                      列出我的项目
- POST /api/v1/projects  body: {"title":"...","engine_type":"drawio|excalidraw|mermaid"}  创建项目 → 返回 project id
- GET  /api/v1/projects/:id                  项目详情（含最新内容）
- PATCH /api/v1/projects/:id  body: {"title":"..."}  改标题
- DELETE /api/v1/projects/:id                 删除项目
- GET  /api/v1/projects/:id/content           读取当前图表源码
- PUT  /api/v1/projects/:id/content  body: {"content":"...","change_summary":"..."}  保存为新版本（替换当前内容，会留下版本历史）
- GET  /api/v1/projects/:id/versions          版本列表（不含内容）
- GET  /api/v1/versions/:id                   版本详情（含内容）

## 文件上传（导入）
- POST /api/v1/files   multipart/form-data，字段名 file
  支持扩展名：.mmd/.mermaid/.excalidraw/.drawio/.xml/.json/.txt
  服务器会解析内容、自动推断引擎并创建项目，返回 { project_id, title, engine_type, version_id }。其他类型返回 415，最大 20MB。

## AI 生成（重要）
- POST /api/v1/generate  body: {"prompt":"你的绘图需求","engine_type":"drawio|excalidraw|mermaid","current_content":"可选，当前图表源码"}
  服务器调用已配置的 LLM（用户的 LLM 配置 > 工作区配置 > 环境变量）生成/修改图表源码，返回 { content, engine_type }。
  注意：此接口只返回生成内容，不自动保存。要保存需接着 PUT /api/v1/projects/:id/content。

# MCP（更推荐 AI 工具使用）
通过 Streamable HTTP 接入，URL：${origin}/mcp，每个请求带 Authorization: Bearer <token>。共 9 个工具：
- list_projects — 列出项目
- get_project(id) — 项目详情 + 最新内容
- get_project_content(id) — 读取图表源码
- create_project(title, engine_type) — 创建项目
- update_project_content(id, content, change_summary?) — 保存内容为新版本
- list_versions(id) — 版本列表
- get_version(id) — 版本内容
- import_diagram(filename, content, title?, engine_type?) — 导入图表文件内容为新项目（自动推断引擎）
- generate_diagram(prompt, engine_type?, project_id?, title?, save?) — AI 生成/修改图表；默认 save=true 会自动创建/更新项目并返回 editor_url；save=false 仅返回内容不落库

# 引擎格式说明
- drawio：XML，根元素为 <mxGraphModel>，需包含标准 mxGraphModel 结构（<root>/<mxCell> 图元与 mxGeometry 几何信息）
- excalidraw：JSON 对象，包含 elements 数组
- mermaid：Mermaid 语法（flowchart/sequenceDiagram/classDiagram 等）

# 编辑器链接
每个项目都有编辑器页面：${origin}/editor/<project_id>
打开后可在界面中导出 PNG/SVG 或复制，首次打开会自动生成项目缩略图。

# 使用建议
1. 用户让你"画一张 XX 图"：先用 generate_diagram(prompt, engine_type) 生成（或 POST /api/v1/generate），默认会保存；然后告诉用户项目已创建及编辑器链接 editor_url。
2. 用户要"修改已有图"：先 get_project_content(project_id) 读取当前内容，再 generate_diagram 传入 project_id（或 POST /api/v1/generate + PUT content）。
3. 用户给了本地图表文件：用 import_diagram（MCP）或 POST /api/v1/files（REST）导入。
4. 生成后应主动返回 editor_url，方便用户打开编辑器查看/导出图片。
5. 所有写操作建议补充 change_summary 便于版本回溯。`

  const aiSystemPromptJson = JSON.stringify(aiSystemPrompt)

  const hasLLMConfig = configLoaded && !!llmConfig.apiKey
  const quotaPercentage = Math.min(100, (quotaUsed / quotaTotal) * 100)

  const refreshQuota = () => {
    UsageService.getToday()
      .then((usage) => {
        setQuotaUsed(usage.used)
        setQuotaTotal(usage.quota)
      })
      .catch((err) => console.error('Failed to load usage:', err))
  }

  // Load the account's saved settings from the server (SQLite source of truth)
  useEffect(() => {
    SettingsService.getLlmConfig()
      .then((saved) => {
        setLlmConfig(saved ?? defaultLlmConfig())
        setConfigLoaded(true)
      })
      .catch((err) => console.error('Failed to load LLM config:', err))
    refreshQuota()
  }, [])

  const handleSaveLLMConfig = async () => {
    if (!llmConfig.apiKey.trim()) {
      showError('请先输入 API 密钥')
      return
    }
    if (!llmConfig.baseUrl.trim()) {
      showError('请先输入 API 基础地址')
      return
    }
    try {
      await SettingsService.saveLlmConfig(llmConfig)
      success('自定义 LLM 配置已保存到账号')
      refreshQuota()
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleResetLLMConfig = async () => {
    try {
      await SettingsService.clearLlmConfig()
      setLlmConfig(defaultLlmConfig())
      setAvailableModels([])
      success('自定义 LLM 配置已清除')
      refreshQuota()
    } catch (err) {
      showError(err instanceof Error ? err.message : '清除失败')
    }
  }

  const handleFetchModels = async () => {
    if (!llmConfig.apiKey || !llmConfig.baseUrl) {
      showError('获取模型前请先填写 API 密钥和基础地址')
      return
    }

    setIsLoadingModels(true)
    try {
      // Preview mode: the unsaved form config is sent once to list models;
      // the saved config always lives in the workspace database.
      const models = await aiService.getModels(llmConfig)
      setAvailableModels(models)
      if (models.length > 0) {
        success(`已加载 ${models.length} 个模型`)
        if (!llmConfig.modelId || !models.includes(llmConfig.modelId)) {
          setLlmConfig({ ...llmConfig, modelId: models[0] })
        }
      } else {
        showError('接口未返回可用模型')
      }
    } catch (error) {
      console.error(error)
      showError(error instanceof Error ? error.message : '获取模型失败')
    } finally {
      setIsLoadingModels(false)
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-kumo-brand text-white">
            <GearSixIcon className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-kumo-default">设置</h1>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <LayerCard className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <UserCircleIcon className="size-5 text-kumo-subtle" />
              <h2 className="text-base font-semibold text-kumo-default">账号</h2>
            </div>
            {isAuthenticated ? (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-kumo-line bg-kumo-base p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-kumo-brand text-lg font-semibold text-white">
                    {user?.username?.slice(0, 1).toUpperCase() || '?'}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-kumo-default">{user?.name || user?.username}</div>
                    <div className="truncate text-sm text-kumo-subtle">{user?.username}</div>
                  </div>
                  {user?.role && (
                    <Badge variant={user.role === 'admin' ? 'blue' : 'neutral'}>
                      {user.role === 'admin' ? '管理员' : '成员'}
                    </Badge>
                  )}
                </div>
                <Button
                  variant="secondary"
                  icon={SignOutIcon}
                  onClick={() => {
                    logout()
                    navigate('/')
                    success('已退出登录')
                  }}
                >
                  退出登录
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-kumo-line bg-kumo-base p-6 text-center">
                <Button variant="primary" onClick={() => navigate('/auth')}>
                  登录或注册
                </Button>
              </div>
            )}
          </LayerCard>

          <LayerCard className="flex flex-col justify-between gap-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <GaugeIcon className="size-5 text-kumo-subtle" />
                <h2 className="text-base font-semibold text-kumo-default">每日额度</h2>
              </div>
              <Badge variant={hasLLMConfig ? 'success' : 'neutral'}>
                {hasLLMConfig ? '已豁免' : `剩余 ${Math.max(0, quotaTotal - quotaUsed)} 次`}
              </Badge>
            </div>
            <Meter label="已用" value={quotaPercentage} customValue={`${quotaUsed} / ${quotaTotal}`} className="w-full" />
            <div className="text-sm text-kumo-subtle">
              {hasLLMConfig ? '自定义 LLM 已启用，不受工作区额度限制' : '服务端按账号统计，AI 请求消耗当日额度'}
            </div>
          </LayerCard>
        </div>

        <LayerCard className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <CodeIcon className="size-5 text-kumo-subtle" />
            <h2 className="text-base font-semibold text-kumo-default">开发者 API · 外部 AI 工具连接</h2>
          </div>

          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-medium text-kumo-default">访问令牌</span>
              <Badge variant="neutral">登录令牌 7 天有效</Badge>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                readOnly
                value={token ?? '未登录，请重新登录获取令牌'}
                onClick={(event) => (event.target as HTMLInputElement).select()}
              />
              <Button
                className="self-start"
                variant="secondary"
                icon={CopyIcon}
                disabled={!token}
                onClick={() => token && copyText(token, '访问令牌')}
              >
                复制
              </Button>
            </div>
            <div className="mt-2 text-xs text-kumo-subtle">
              登录令牌用于 REST API 的 Authorization: Bearer 头，过期后重新登录即可获取新令牌。若需给 AI/脚本长期使用，推荐生成一个可撤销的 API 令牌：
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={KeyIcon}
                disabled={!isAuthenticated}
                onClick={handleGenerateApiToken}
              >
                生成永久 API 令牌
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={ArrowClockwiseIcon}
                disabled={!isAuthenticated || apiTokens.length === 0}
                onClick={loadApiTokens}
              >
                刷新令牌列表
              </Button>
              {apiTokens.length > 0 && (
                <span className="text-xs text-kumo-subtle">{apiTokens.length} 个有效 API 令牌</span>
              )}
            </div>
            {apiTokens.length > 0 && (
              <div className="mt-3 space-y-2">
                {apiTokens.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-kumo-default">{t.name || '(未命名)'}</div>
                      <div className="truncate text-kumo-subtle">
                        {t.expires_at ? `有效期至 ${new Date(t.expires_at).toLocaleString('zh-CN')}` : '永久有效'}
                        {t.last_used_at ? ` · 最近使用 ${new Date(t.last_used_at).toLocaleString('zh-CN')}` : ''}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      icon={XIcon}
                      onClick={() => revokeApiToken(t.id)}
                    >
                      撤销
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Tabs
            tabs={[
              { value: 'rest', label: 'REST API' },
              { value: 'mcp', label: 'MCP Server' },
            ]}
            value={apiTab}
            onValueChange={(value) => setApiTab(String(value))}
            variant="segmented"
            className="mb-4 w-max"
          />

          {apiTab === 'rest' ? (
            <div className="space-y-3 text-sm">
              <div className="overflow-x-auto rounded-lg border border-kumo-line bg-kumo-base">
                <table className="w-full text-left text-sm">
                  <thead className="text-kumo-subtle">
                    <tr className="border-b border-kumo-line">
                      <th className="px-3 py-2 font-medium">方法</th>
                      <th className="px-3 py-2 font-medium">路径</th>
                      <th className="px-3 py-2 font-medium">说明</th>
                    </tr>
                  </thead>
                  <tbody className="text-kumo-default">
                    <tr className="border-b border-kumo-line/60">
                      <td className="px-3 py-1.5">GET</td>
                      <td className="px-3 py-1.5 font-mono text-xs">/api/v1/projects</td>
                      <td className="px-3 py-1.5">列出项目</td>
                    </tr>
                    <tr className="border-b border-kumo-line/60">
                      <td className="px-3 py-1.5">POST</td>
                      <td className="px-3 py-1.5 font-mono text-xs">/api/v1/projects</td>
                      <td className="px-3 py-1.5">创建项目</td>
                    </tr>
                    <tr className="border-b border-kumo-line/60">
                      <td className="px-3 py-1.5">GET/PUT</td>
                      <td className="px-3 py-1.5 font-mono text-xs">/api/v1/projects/:id/content</td>
                      <td className="px-3 py-1.5">读取 / 保存图表内容</td>
                    </tr>
                    <tr className="border-b border-kumo-line/60">
                      <td className="px-3 py-1.5">GET</td>
                      <td className="px-3 py-1.5 font-mono text-xs">/api/v1/projects/:id/versions</td>
                      <td className="px-3 py-1.5">版本历史</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1.5">POST</td>
                      <td className="px-3 py-1.5 font-mono text-xs">/api/v1/generate</td>
                      <td className="px-3 py-1.5">AI 生成 / 修改图表</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="flex items-start justify-between gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-kumo-line bg-kumo-base p-3 font-mono text-xs leading-relaxed text-kumo-default">
                  {restLoginExample}
                </pre>
                <Button variant="secondary" size="sm" icon={CopyIcon} onClick={() => copyText(restLoginExample, 'curl 示例')}>
                  复制
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="text-kumo-subtle">
                通过 Streamable HTTP 在线接入，无需与服务器同机部署。下面的配置已自动填入当前登录令牌（7 天有效，过期后回到本页重新复制）。
                MCP 提供 opencode、Claude Code、Codex 原生集成的图表工作区工具（列项目、读写内容、AI 生成）。
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-kumo-subtle">Claude Code · .mcp.json</div>
                <div className="flex items-start justify-between gap-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-kumo-line bg-kumo-base p-3 font-mono text-xs leading-relaxed text-kumo-default">
                    {mcpClaudeConfig}
                  </pre>
                  <Button variant="secondary" size="sm" icon={CopyIcon} onClick={() => copyText(mcpClaudeConfig, 'Claude Code 配置')}>
                    复制
                  </Button>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-kumo-subtle">opencode · opencode.json</div>
                <div className="flex items-start justify-between gap-2">
                  <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-kumo-line bg-kumo-base p-3 font-mono text-xs leading-relaxed text-kumo-default">
                    {mcpOpencodeConfig}
                   </pre>
                  <Button variant="secondary" size="sm" icon={CopyIcon} onClick={() => copyText(mcpOpencodeConfig, 'opencode 配置')}>
                    复制
                  </Button>
                </div>
              </div>
            </div>
          )}
        </LayerCard>

        <LayerCard className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <SparkleIcon className="size-5 text-kumo-subtle" />
            <h2 className="text-base font-semibold text-kumo-default">AI 接入提示词</h2>
          </div>
          <div className="space-y-3 text-sm">
            <div className="text-kumo-subtle">
              把这段提示词粘贴给你的 AI 助手（Claude Code、opencode 或任意对话式 AI），它会完全理解本工作区的 REST API 与 MCP 工具，正确帮你创建/读取/修改/生成图表。提示词已内嵌你的访问令牌与服务器地址。
            </div>
            <div className="flex items-start justify-between gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-kumo-line bg-kumo-base p-3 font-mono text-xs leading-relaxed text-kumo-default">
                {aiSystemPrompt}
              </pre>
              <Button
                variant="secondary"
                size="sm"
                icon={CopyIcon}
                onClick={() => copyText(aiSystemPrompt, 'AI 接入提示词')}
              >
                复制
              </Button>
            </div>
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs text-kumo-subtle">
                以 JSON 字符串形式复制（适合放入 system prompt / 配置文件）：
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={CopyIcon}
                onClick={() => copyText(aiSystemPromptJson, 'AI 提示词(JSON)')}
              >
                复制 JSON
              </Button>
            </div>
          </div>
        </LayerCard>

        <LayerCard className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <CpuIcon className="size-5 text-kumo-subtle" />
            <h2 className="text-base font-semibold text-kumo-default">自定义 LLM</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="服务商"
              hideLabel={false}
              value={llmConfig.provider}
              renderValue={(value) => providerLabels[String(value)] ?? String(value)}
              onValueChange={(value) => setLlmConfig({ ...llmConfig, provider: String(value) })}
            >
              <Select.Option value="openai">{providerLabels.openai}</Select.Option>
              <Select.Option value="anthropic">{providerLabels.anthropic}</Select.Option>
            </Select>

            <Input
              label="API 基础地址"
              value={llmConfig.baseUrl}
              onChange={(event) => setLlmConfig({ ...llmConfig, baseUrl: event.target.value })}
              placeholder="https://api.openai.com/v1"
              autoComplete="off"
            />

            <SensitiveInput
              label="API 密钥"
              value={llmConfig.apiKey}
              onValueChange={(value) => setLlmConfig({ ...llmConfig, apiKey: value })}
              placeholder="sk-..."
              autoComplete="new-password"
            />

            <div className="grid gap-3">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Input
                  label="模型 ID"
                  value={llmConfig.modelId}
                  onChange={(event) => setLlmConfig({ ...llmConfig, modelId: event.target.value })}
                  placeholder="gpt-4o-mini"
                  autoComplete="off"
                />
                <Button
                  className="self-end"
                  variant="secondary"
                  icon={ArrowClockwiseIcon}
                  loading={isLoadingModels}
                  onClick={handleFetchModels}
                >
                  获取模型
                </Button>
              </div>

              {availableModels.length > 0 && (
                <Select
                  label="可用模型"
                  hideLabel={false}
                  value={llmConfig.modelId}
                  onValueChange={(value) => setLlmConfig({ ...llmConfig, modelId: String(value) })}
                >
                  {availableModels.map((model) => (
                    <Select.Option key={model} value={model}>
                      {model}
                    </Select.Option>
                  ))}
                </Select>
              )}
            </div>

            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" variant="primary" icon={FloppyDiskIcon} onClick={handleSaveLLMConfig}>
                保存
              </Button>
              <Button size="sm" variant="secondary" icon={ArrowClockwiseIcon} onClick={handleResetLLMConfig}>
                重置
              </Button>
            </div>
          </div>
        </LayerCard>
      </div>
    </div>
  )
}
