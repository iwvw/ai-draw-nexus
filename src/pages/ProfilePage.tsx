import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Input, LayerCard, Meter, Select, SensitiveInput } from '@cloudflare/kumo'
import {
  ArrowClockwiseIcon,
  CodeIcon,
  CopyIcon,
  CpuIcon,
  FloppyDiskIcon,
  GaugeIcon,
  KeyIcon,
  SignOutIcon,
  SparkleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useToast } from '@/hooks/useToast'
import { aiService } from '@/services/aiService'
import { SettingsService, UsageService, type LlmConfig } from '@/services/settingsService'
import { useAuthStore } from '@/stores/authStore'

function defaultLlmConfig(): LlmConfig {
  return { provider: 'openai', baseUrl: '', apiKey: '', modelId: '' }
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
  const [apiTokens, setApiTokens] = useState<ApiTokenItem[]>([])
  const [llmDraft, setLlmDraft] = useState<LlmConfig | null>(null)
  const [newToken, setNewToken] = useState('')
  const [tokenExpires, setTokenExpires] = useState<string>('0')

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
      const days = Number(tokenExpires) || 0
      const res = await fetch('/api/auth/api-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: days > 0 ? `${days} 天令牌` : '永久令牌', expires_in_days: days }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(json?.error || '生成令牌失败')
      }
      const json = (await res.json()) as { token: string; expires_in_days: number }
      setNewToken(json.token)
      success('已生成，请复制保存（仅本次可见）')
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

  const restExample = `# 用 API 令牌调用（Token 已自动填入；未登录时请替换 <API_TOKEN>）
curl ${origin}/api/v1/projects \\
  -H "Authorization: Bearer ${token ?? '<API_TOKEN>'}"

# 例：读取某个项目的图表源码
curl ${origin}/api/v1/projects/<PROJECT_ID>/content \\
  -H "Authorization: Bearer ${token ?? '<API_TOKEN>'}"`

  const mcpConfig = `{
  "mcpServers": {
    "ai-draw-nexus": {
      "type": "http",
      "url": "${origin}/mcp",
      "headers": { "Authorization": "Bearer ${token ?? '<token>'}" }
    }
  }
}`

  const aiPromptUrl = `${origin}/ai-prompt.txt`

  // AI 一句话安装提示词（强制经 MCP 绘图，禁止自行绘制或上传）
  const aiPromptOneLine = token
    ? `请接入我的 AI Draw Nexus 图表工作区。优先通过 MCP 接入：配置 MCP 服务器 URL 为 ${origin}/mcp，并用 HTTP 头 Authorization: Bearer ${token} 认证，然后使用 MCP 工具操作（get_project_content、update_project_content、create_project、list_versions、import_diagram 等）。你自身可能不具备绘图能力，且不可自行绘制图表或上传文件：新建/修改图表必须调用 MCP 的 generate_diagram 工具，由工作区配置的绘图模型生成，而不是你直接输出图表内容。完整接口见 ${aiPromptUrl}；REST API 仅作备用，且同样应优先调用 /api/v1/generate。`
    : `请接入我的 AI Draw Nexus 图表。优先通过 MCP 接入（URL ${origin}/mcp），用 MCP 工具操作；Token 让用户登录后在「设置 → API 令牌」提供，或经 MCP 的 get_access_token 动态获取。禁止自行绘制或上传图表文件，建图/改图必须调用 MCP 的 generate_diagram 工具，由绘图程序配置的模型生成。完整接口见 ${aiPromptUrl}。`

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

  useEffect(() => {
    SettingsService.getLlmConfig()
      .then((saved) => {
        const base = saved ?? defaultLlmConfig()
        setLlmConfig(base)
        setLlmDraft(base)
        setConfigLoaded(true)
      })
      .catch((err) => console.error('Failed to load LLM config:', err))
    refreshQuota()
  }, [])

  const handleSaveLLMConfig = async () => {
    if (!llmDraft) return
    if (!llmDraft.apiKey.trim()) return showError('请先输入 API 密钥')
    if (!llmDraft.baseUrl.trim()) return showError('请先输入 API 基础地址')
    try {
      await SettingsService.saveLlmConfig(llmDraft)
      setLlmConfig(llmDraft)
      success('自定义 LLM 配置已保存到账号')
      refreshQuota()
    } catch (err) {
      showError(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleResetLLMConfig = async () => {
    try {
      await SettingsService.clearLlmConfig()
      const fresh = defaultLlmConfig()
      setLlmConfig(fresh)
      setLlmDraft(fresh)
      setAvailableModels([])
      success('自定义 LLM 配置已清除')
      refreshQuota()
    } catch (err) {
      showError(err instanceof Error ? err.message : '清除失败')
    }
  }

  const handleFetchModels = async () => {
    if (!llmDraft?.apiKey || !llmDraft.baseUrl) return showError('请先填写 API 密钥和基础地址')
    setIsLoadingModels(true)
    try {
      const models = await aiService.getModels(llmDraft)
      setAvailableModels(models)
      if (models.length > 0) {
        success(`已加载 ${models.length} 个模型`)
        if (!llmDraft.modelId || !models.includes(llmDraft.modelId)) {
          setLlmDraft({ ...llmDraft, modelId: models[0] })
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

  const set = (patch: Partial<LlmConfig>) => setLlmDraft((d) => ({ ...defaultLlmConfig(), ...llmConfig, ...d, ...patch }))

  const restRows = [
    { method: 'GET', path: '/api/v1/projects', desc: '列出项目' },
    { method: 'POST', path: '/api/v1/projects', desc: '创建项目' },
    { method: 'GET/PUT', path: '/api/v1/projects/:id/content', desc: '读取/保存图表内容' },
    { method: 'GET', path: '/api/v1/projects/:id/versions', desc: '版本历史' },
    { method: 'POST', path: '/api/v1/generate', desc: 'AI 生成/修改图表' },
  ]

  return (
    <div className="px-5 py-4">
      <div className="mx-auto grid w-full items-start gap-6 xl:grid-cols-2">
        {/* 左列 */}
        <div className="flex flex-col gap-6">
          {/* 账号 + 每日额度 */}
          <LayerCard>
            <LayerCard.Secondary>账号</LayerCard.Secondary>
            <LayerCard.Primary>
              {isAuthenticated ? (
                <div className="flex flex-wrap items-center justify-between gap-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-11 shrink-0 select-none items-center justify-center rounded-full bg-kumo-brand text-sm font-semibold text-white">
                      {user?.username?.slice(0, 1).toUpperCase() || '?'}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-kumo-default">{user?.name || user?.username}</div>
                      <div className="truncate text-sm text-kumo-subtle">{user?.username}</div>
                    </div>
                    {user?.role && (
                      <Badge variant={user.role === 'admin' ? 'blue' : 'neutral'}>
                        {user.role === 'admin' ? '管理员' : '成员'}
                      </Badge>
                    )}
                  </div>
                  <div className="flex min-w-[16rem] flex-1 flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm text-kumo-subtle">
                        <GaugeIcon className="size-4" />
                        今日额度
                      </span>
                      <Badge variant={hasLLMConfig ? 'success' : 'neutral'}>
                        {hasLLMConfig ? '已豁免' : `剩余 ${Math.max(0, quotaTotal - quotaUsed)} 次`}
                      </Badge>
                    </div>
                    <Meter label="已用" value={quotaPercentage} customValue={`${quotaUsed} / ${quotaTotal}`} className="w-full" />
                  </div>
                  <Button
                    variant="secondary"
                    icon={SignOutIcon}
                    onClick={() => { logout(); navigate('/'); success('已退出登录') }}
                  >
                    退出登录
                  </Button>
                </div>
              ) : (
                <Button variant="primary" onClick={() => navigate('/auth')}>
                  登录或注册
                </Button>
              )}
            </LayerCard.Primary>
          </LayerCard>

          {/* token 管理 */}
          <LayerCard>
            <LayerCard.Secondary>
              <span className="flex items-center gap-2">
                <KeyIcon className="size-4" />
                API 令牌
              </span>
            </LayerCard.Secondary>
            <LayerCard.Primary>
              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-medium text-kumo-default">登录令牌</span>
                    <Badge variant="neutral">7 天有效</Badge>
                  </div>
                  <div className="flex items-end gap-2">
                    <Input
                      className="flex-1"
                      readOnly
                      value={token ?? '未登录，请重新登录获取令牌'}
                      onClick={(event) => (event.target as HTMLInputElement).select()}
                    />
                    <Button variant="secondary" icon={CopyIcon} disabled={!token} onClick={() => token && copyText(token, '登录令牌')}>
                      复制
                    </Button>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-kumo-default">生成 API 令牌</span>
                    <div className="flex items-center gap-2">
                      <Select
                        className="w-32"
                        value={tokenExpires}
                        onValueChange={(value) => setTokenExpires(String(value))}
                        aria-label="有效期"
                      >
                        <Select.Option value="0">永久有效</Select.Option>
                        <Select.Option value="7">7 天</Select.Option>
                        <Select.Option value="30">30 天</Select.Option>
                        <Select.Option value="365">365 天</Select.Option>
                      </Select>
                      <Button size="sm" variant="secondary" icon={KeyIcon} disabled={!isAuthenticated} onClick={handleGenerateApiToken}>
                        生成
                      </Button>
                    </div>
                  </div>

                  {newToken && (
                    <div className="flex items-end gap-2">
                      <Input
                        className="flex-1 font-mono"
                        readOnly
                        value={newToken}
                        onClick={(event) => (event.target as HTMLInputElement).select()}
                      />
                      <Button variant="secondary" icon={CopyIcon} onClick={() => copyText(newToken, 'API 令牌')}>
                        复制
                      </Button>
                    </div>
                  )}
                </div>

                {apiTokens.length > 0 ? (
                  <div className="space-y-2">
                    {apiTokens.map((t) => (
                      <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-kumo-default">{t.name || '(未命名)'}</div>
                          <div className="truncate text-kumo-subtle">
                            {t.expires_at ? `有效期至 ${new Date(t.expires_at).toLocaleString('zh-CN')}` : '永久有效'}
                            {t.last_used_at ? ` · 最近使用 ${new Date(t.last_used_at).toLocaleString('zh-CN')}` : ''}
                          </div>
                        </div>
                        <Button size="sm" variant="destructive" icon={XIcon} onClick={() => revokeApiToken(t.id)}>
                          撤销
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-kumo-subtle">暂无永久令牌。生成后用于长期运行的脚本或 AI 工具。</p>
                )}
              </div>
            </LayerCard.Primary>
          </LayerCard>

          {/* AI 接入 · 一句话安装 */}
          <LayerCard>
            <LayerCard.Secondary>
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <SparkleIcon className="size-4" />
                  AI 接入 · 一句话安装
                </span>
                <Button size="sm" variant="secondary" icon={CopyIcon} onClick={() => copyText(aiPromptOneLine, 'AI 安装提示词')}>
                  复制
                </Button>
              </span>
            </LayerCard.Secondary>
            <LayerCard.Primary>
              <div className="flex flex-col gap-2">
                <p className="text-xs text-kumo-subtle">
                  把这句提示词复制给你的 AI 助手。它会优先经 MCP 接入，并通过工作区绘图模型生成图表。
                </p>
                <textarea
                  className="h-28 w-full resize-none overflow-auto rounded-lg border border-kumo-line bg-kumo-base p-3 font-mono text-xs leading-relaxed text-kumo-default"
                  readOnly
                  value={aiPromptOneLine}
                  onClick={(event) => (event.target as HTMLTextAreaElement).select()}
                />
              </div>
            </LayerCard.Primary>
          </LayerCard>
        </div>

        {/* 右列 */}
        <div className="flex flex-col gap-6">
          {/* 自定义 LLM */}
          <LayerCard>
            <LayerCard.Secondary>
              <span className="flex items-center gap-2">
                <CpuIcon className="size-4" />
                自定义 LLM
              </span>
            </LayerCard.Secondary>
            <LayerCard.Primary>
              <div className="grid gap-3 md:grid-cols-2">
                <Select
                  label="服务商"
                  value={llmDraft?.provider ?? llmConfig.provider}
                  renderValue={(value) => providerLabels[String(value)] ?? String(value)}
                  onValueChange={(value) => set({ provider: String(value) })}
                >
                  <Select.Option value="openai">{providerLabels.openai}</Select.Option>
                  <Select.Option value="anthropic">{providerLabels.anthropic}</Select.Option>
                </Select>

                <Input
                  label="API 基础地址"
                  value={llmDraft?.baseUrl ?? llmConfig.baseUrl}
                  onChange={(event) => set({ baseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                  autoComplete="off"
                />

                <SensitiveInput
                  label="API 密钥"
                  value={llmDraft?.apiKey ?? llmConfig.apiKey}
                  onValueChange={(value) => set({ apiKey: value })}
                  placeholder="sk-..."
                  autoComplete="new-password"
                />

                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                  <Input
                    label="模型 ID"
                    value={llmDraft?.modelId ?? llmConfig.modelId}
                    onChange={(event) => set({ modelId: event.target.value })}
                    placeholder="gpt-4o-mini"
                    autoComplete="off"
                  />
                  <Button variant="secondary" icon={ArrowClockwiseIcon} loading={isLoadingModels} onClick={handleFetchModels}>
                    获取模型
                  </Button>
                </div>

                {availableModels.length > 0 && (
                  <Select
                    label="可用模型"
                    value={llmDraft?.modelId ?? llmConfig.modelId}
                    onValueChange={(value) => set({ modelId: String(value) })}
                  >
                    {availableModels.map((model) => (
                      <Select.Option key={model} value={model}>
                        {model}
                      </Select.Option>
                    ))}
                  </Select>
                )}

                <div className="flex gap-2 md:col-span-2">
                  <Button size="sm" variant="primary" icon={FloppyDiskIcon} onClick={handleSaveLLMConfig}>
                    保存
                  </Button>
                  <Button size="sm" variant="secondary" icon={ArrowClockwiseIcon} onClick={handleResetLLMConfig}>
                    重置
                  </Button>
                </div>
              </div>
            </LayerCard.Primary>
          </LayerCard>

          {/* REST API */}
          <LayerCard>
            <LayerCard.Secondary>
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <CodeIcon className="size-4" />
                  REST API
                </span>
                <Button size="sm" variant="secondary" icon={CopyIcon} onClick={() => copyText(restExample, 'curl 示例')}>
                  复制示例
                </Button>
              </span>
            </LayerCard.Secondary>
            <LayerCard.Primary>
              <div className="space-y-4">
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
                      {restRows.map((row, i) => (
                        <tr key={i} className={i < restRows.length - 1 ? 'border-b border-kumo-line/60' : ''}>
                          <td className="px-3 py-1.5">{row.method}</td>
                          <td className="px-3 py-1.5 font-mono text-xs">{row.path}</td>
                          <td className="px-3 py-1.5">{row.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <pre className="max-h-44 min-w-0 flex-1 overflow-auto rounded-lg border border-kumo-line bg-kumo-base p-3 font-mono text-xs leading-relaxed text-kumo-default">
                  {restExample}
                </pre>
              </div>
            </LayerCard.Primary>
          </LayerCard>

          {/* MCP 接入 */}
          <LayerCard>
            <LayerCard.Secondary>
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <CpuIcon className="size-4" />
                  MCP 接入
                </span>
                <Button size="sm" variant="secondary" icon={CopyIcon} onClick={() => copyText(mcpConfig, 'MCP 配置')}>
                  复制
                </Button>
              </span>
            </LayerCard.Secondary>
            <LayerCard.Primary>
              <p className="mb-2 text-xs text-kumo-subtle">
                将下方配置写入你的 MCP 客户端（如 Claude Code、opencode）。MCP 提供项目读写与 AI 生成等图表工作区工具。
              </p>
              <pre className="max-h-56 min-w-0 overflow-auto rounded-lg border border-kumo-line bg-kumo-base p-3 font-mono text-xs leading-relaxed text-kumo-default">
                {mcpConfig}
              </pre>
            </LayerCard.Primary>
          </LayerCard>
        </div>
      </div>
    </div>
  )
}