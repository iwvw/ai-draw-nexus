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

  const aiPromptUrl = `${origin}/ai-prompt.txt`

  const aiSystemPrompt = `请阅读 ${aiPromptUrl}，按照其中的说明接入并操作我的 AI Draw Nexus 图表工作区。访问令牌见下方（用前替换 <token> 占位）。`

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
              系统已为你的 AI 助手（Claude Code、opencode 或任意对话式 AI）准备了一份完整的功能说明，存放在下方链接。AI
              可自动读取它，从而完全理解本工作区的 REST API 与 MCP 工具，正确创建/读取/修改/生成图表。链接不含令牌，可安全共享。
            </div>
            <div className="flex items-start justify-between gap-2">
              <Input
                readOnly
                value={aiPromptUrl}
                onClick={(event) => (event.target as HTMLInputElement).select()}
              />
              <Button
                className="self-start"
                variant="secondary"
                size="sm"
                icon={CopyIcon}
                onClick={() => copyText(aiPromptUrl, '提示词链接')}
              >
                复制链接
              </Button>
            </div>
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs text-kumo-subtle">
                或复制下方这段极简提示词，直接粘贴给 AI（它会先读取链接再行动）：
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={CopyIcon}
                onClick={() => copyText(aiSystemPrompt, 'AI 接入提示词')}
              >
                复制提示词
              </Button>
            </div>
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs text-kumo-subtle">
                JSON 字符串版（适合放入 system prompt / 配置文件）：
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
            <div className="text-xs text-kumo-subtle">
              提示：AI 读取链接后仍需你的访问令牌才能调用 API/MCP。请把上方「访问令牌」一并提供（用前替换
              <code className="mx-1 rounded bg-kumo-base px-1 font-mono">&lt;token&gt;</code> 占位），或让 AI 先调用登录接口获取。
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
