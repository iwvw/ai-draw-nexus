import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Banner, Button, Chart, Input, LayerCard, RefreshButton, Select, SensitiveInput, Switch, Table, Tabs, type KumoChartOption } from '@cloudflare/kumo'
import { ArrowClockwiseIcon, FloppyDiskIcon, ShieldWarningIcon } from '@phosphor-icons/react'
import * as echarts from 'echarts/core'
import { BarChart, PieChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useAuthStore } from '@/stores/authStore'
import { useToast } from '@/hooks/useToast'
import { aiService } from '@/services/aiService'
import { ENGINES } from '@/constants'
import {
  AdminService,
  type AdminAuditRecord,
  type AdminProject,
  type AdminSetting,
  type AdminStats,
  type AdminUsageRecord,
  type AdminUser,
  type AiTrendPoint,
} from '@/services/adminService'

echarts.use([BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

type AdminTab = 'overview' | 'users' | 'projects' | 'settings' | 'usage' | 'audit'

const tabs = [
  { value: 'overview', label: '概览' },
  { value: 'users', label: '用户' },
  { value: 'projects', label: '项目' },
  { value: 'settings', label: '设置' },
  { value: 'usage', label: '用量' },
  { value: 'audit', label: '审计' },
]

const roleLabels: Record<string, string> = {
  admin: '管理员',
  member: '成员',
}

const statusLabels: Record<string, string> = {
  active: '启用',
  suspended: '已停用',
}

const actionLabels: Record<string, string> = {
  'auth.register': '用户注册',
  'auth.login': '用户登录',
  'admin.user.create': '后台创建用户',
  'admin.user.update': '后台更新用户',
  'admin.setting.update': '后台更新设置',
  'project.create': '创建项目',
  'project.update': '更新项目',
  'project.delete': '删除项目',
}

const targetTypeLabels: Record<string, string> = {
  user: '用户',
  project: '项目',
  setting: '设置',
}

const settingLabels: Record<string, string> = {
  'ai.provider_defaults': 'AI 默认模型配置',
  'ai.daily_quota': 'AI 每日额度',
  'security.allow_registration': '开放注册',
  'security.allow_public_access': '公开访问',
}

const metadataLabels: Record<string, string> = {
  role: '角色',
  status: '状态',
  name: '名称',
  email: '邮箱',
  username: '用户名',
  title: '标题',
  engineType: '绘图引擎',
  engine_type: '绘图引擎',
  visibility: '可见性',
  value: '值',
  previous: '变更前',
  next: '变更后',
}

function formatDate(value?: string | null) {
  if (!value) return '从未'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function engineLabel(engineType: string) {
  return ENGINES.find((engine) => engine.value === engineType)?.label ?? engineType
}

function recentDays(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - (n - 1 - i))
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  })
}

function displayRole(role: string) {
  return roleLabels[role] ?? role
}

function displayStatus(status: string) {
  return statusLabels[status] ?? status
}

function statusBadge(status: string) {
  return <Badge variant={status === 'active' ? 'success' : 'warning'}>{displayStatus(status)}</Badge>
}

function formatAuditMetadata(metadata: string) {
  if (!metadata || metadata === '{}') return '-'

  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>
    const entries = Object.entries(parsed)
    if (entries.length === 0) return '-'

    return entries
      .map(([key, value]) => {
        const label = metadataLabels[key] ?? key
        const displayValue =
          key === 'role' && typeof value === 'string'
            ? displayRole(value)
            : key === 'status' && typeof value === 'string'
              ? displayStatus(value)
              : String(value)
        return `${label}：${displayValue}`
      })
      .join('；')
  } catch {
    return metadata
  }
}

export function AdminPage() {
  const navigate = useNavigate()
  const { isAuthenticated, user } = useAuthStore()
  const { success: showSuccess, error: showError } = useToast()
  const [activeTab, setActiveTab] = useState<AdminTab>('overview')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [projects, setProjects] = useState<AdminProject[]>([])
  const [settings, setSettings] = useState<AdminSetting[]>([])
  const [usage, setUsage] = useState<AdminUsageRecord[]>([])
  const [audit, setAudit] = useState<AdminAuditRecord[]>([])
  const [aiTrend, setAiTrend] = useState<AiTrendPoint[]>([])
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({})
  const [providerDraft, setProviderDraft] = useState({ provider: 'openai', baseUrl: '', apiKey: '', modelId: '' })
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const loadModelsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const providerDraftRef = useRef(providerDraft)
  useEffect(() => {
    providerDraftRef.current = providerDraft
  })
  const [loading, setLoading] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = user?.role === 'admin'

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextStats, nextUsers, nextProjects, nextSettings, nextUsage, nextAudit, nextAiTrend] = await Promise.all([
        AdminService.getStats(),
        AdminService.listUsers(),
        AdminService.listProjects(),
        AdminService.listSettings(),
        AdminService.listUsage(),
        AdminService.listAudit(),
        AdminService.getAiTrend(7),
      ])
      setStats(nextStats)
      setUsers(nextUsers)
      setProjects(nextProjects)
      setSettings(nextSettings)
      setUsage(nextUsage)
      setAudit(nextAudit)
      setAiTrend(nextAiTrend)
      setSettingDrafts(Object.fromEntries(nextSettings.map((setting) => [setting.key, setting.value])))
      const providerDefaults = nextSettings.find((setting) => setting.key === 'ai.provider_defaults')
      if (providerDefaults) {
        try {
          const parsed = JSON.parse(providerDefaults.value) as Record<string, unknown>
          setProviderDraft({
            provider: String(parsed.provider ?? 'openai'),
            baseUrl: String(parsed.baseUrl ?? ''),
            apiKey: String(parsed.apiKey ?? ''),
            modelId: String(parsed.modelId ?? ''),
          })
        } catch {
          // 保持默认草稿
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '后台数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/auth')
      return
    }
    if (isAdmin) {
      loadData()
    }
  }, [isAuthenticated, isAdmin, loadData, navigate])

  const fetchModels = useCallback(async (config: typeof providerDraft, notifyOnError = false) => {
    if (!config.apiKey.trim() || !config.baseUrl.trim()) {
      if (notifyOnError) showError('请先填写 API 密钥和基础地址')
      return
    }

    setIsLoadingModels(true)
    try {
      const models = await aiService.getModels(config)
      setAvailableModels(models)
      setProviderDraft((current) => {
        if (models.length > 0 && !current.modelId) return { ...current, modelId: models[0] }
        return current
      })
      if (notifyOnError && models.length === 0) showError('接口未返回可用模型')
    } catch (err) {
      console.error('Failed to load models:', err)
      setAvailableModels([])
      if (notifyOnError) showError(err instanceof Error ? err.message : '模型列表加载失败')
    } finally {
      setIsLoadingModels(false)
    }
  }, [showError])

  // 自动加载模型：服务商/地址/密钥变化时防抖拉取
  useEffect(() => {
    if (loadModelsTimer.current) clearTimeout(loadModelsTimer.current)
    if (!providerDraft.apiKey.trim() || !providerDraft.baseUrl.trim()) {
      setAvailableModels([])
      return
    }
    loadModelsTimer.current = setTimeout(() => fetchModels(providerDraftRef.current), 800)
    return () => {
      if (loadModelsTimer.current) clearTimeout(loadModelsTimer.current)
    }
  }, [providerDraft.apiKey, providerDraft.baseUrl, providerDraft.provider, fetchModels])

  const saveAllSettings = useCallback(async () => {
    setIsSavingSettings(true)
    try {
      await Promise.all([
        AdminService.updateSetting('ai.provider_defaults', providerDraft),
        ...settings
          .filter(
            (setting) =>
              setting.key !== 'ai.provider_defaults' &&
              setting.key !== 'security.allow_registration' &&
              setting.key !== 'security.allow_public_access',
          )
          .map((setting) => {
            const raw = settingDrafts[setting.key] ?? setting.value
            const value = setting.key === 'ai.daily_quota' ? (Number.isFinite(Number(raw)) ? Number(raw) : 0) : raw
            return AdminService.updateSetting(setting.key, value)
          }),
      ])
      await loadData()
      showSuccess('设置已保存')
    } catch (err) {
      showError(err instanceof Error ? err.message : '设置保存失败')
    } finally {
      setIsSavingSettings(false)
    }
  }, [providerDraft, settings, settingDrafts, loadData, showSuccess, showError])

  const statCards = useMemo(
    () => [
      { label: '用户', value: stats?.users ?? 0 },
      { label: '启用用户', value: stats?.activeUsers ?? 0 },
      { label: '管理员', value: stats?.admins ?? 0 },
      { label: '项目', value: stats?.projects ?? 0 },
      { label: '版本', value: stats?.versions ?? 0 },
      { label: '今日 AI 请求', value: stats?.aiRequestsToday ?? 0 },
    ],
    [stats],
  )

  const aiTrendByDay = useMemo(() => {
    const map = new Map<string, { success: number; failed: number }>()
    for (const point of aiTrend) {
      const entry = map.get(point.day) ?? { success: 0, failed: 0 }
      if (point.status === 'failed') entry.failed += point.count
      else entry.success += point.count
      map.set(point.day, entry)
    }
    return map
  }, [aiTrend])

  const aiTrendTotal = useMemo(
    () => [...aiTrendByDay.values()].reduce((sum, day) => sum + day.success + day.failed, 0),
    [aiTrendByDay],
  )

  const aiTrendSuccessRate = useMemo(() => {
    if (aiTrendTotal === 0) return 100
    const success = [...aiTrendByDay.values()].reduce((sum, day) => sum + day.success, 0)
    return Math.round((success / aiTrendTotal) * 100)
  }, [aiTrendByDay, aiTrendTotal])

  const aiTrendOptions = useMemo<KumoChartOption>(() => {
    const days = recentDays(7)
    const data = days.map((day) => aiTrendByDay.get(day) ?? { success: 0, failed: 0 })
    return {
      tooltip: { trigger: 'axis' },
      legend: { top: 0, right: 0 },
      grid: { left: 8, right: 16, top: 32, bottom: 0, containLabel: true },
      xAxis: { type: 'category', data: days, boundaryGap: true },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: '成功',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 28,
          data: data.map((day) => day.success),
        },
        {
          name: '失败',
          type: 'bar',
          stack: 'total',
          barMaxWidth: 28,
          itemStyle: { color: '#FC574A', borderRadius: [4, 4, 0, 0] },
          data: data.map((day) => day.failed),
        },
      ],
    }
  }, [aiTrendByDay])

  const engineDistributionOptions = useMemo<KumoChartOption>(() => {
    const counts = new Map<string, number>()
    for (const project of projects) {
      counts.set(project.engine_type, (counts.get(project.engine_type) ?? 0) + 1)
    }
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 },
          label: { show: false },
          emphasis: { label: { show: true, fontWeight: 600 } },
          data: [...counts.entries()].map(([type, value]) => ({ name: engineLabel(type), value })),
        },
      ],
    }
  }, [projects])

  const userProjectsOptions = useMemo<KumoChartOption>(() => {
    const topUsers = [...users].sort((a, b) => b.project_count - a.project_count).slice(0, 10)
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 8, right: 24, top: 8, bottom: 0, containLabel: true },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: {
        type: 'category',
        inverse: true,
        data: topUsers.map((adminUser) => adminUser.username),
        axisLabel: { width: 96, overflow: 'truncate' },
      },
      series: [
        {
          type: 'bar',
          data: topUsers.map((adminUser) => adminUser.project_count),
          barMaxWidth: 16,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
        },
      ],
    }
  }, [users])

  if (!isAdmin) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-6">
        <LayerCard className="max-w-md p-6 text-center">
          <ShieldWarningIcon className="mx-auto mb-3 size-8 text-kumo-warning" />
          <h1 className="text-xl font-semibold">需要管理员权限</h1>
          <p className="mt-2 text-sm text-kumo-subtle">
            当前账号已登录，但没有后台管理角色。
          </p>
          <Button className="mx-auto mt-5" onClick={() => navigate('/')}>
            返回工作区
          </Button>
        </LayerCard>
      </div>
    )
  }

  return (
    <div className="w-full p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <Tabs
          tabs={tabs}
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as AdminTab)}
          variant="segmented"
          className="w-max max-w-full"
        />
        <div className="flex shrink-0 items-center gap-2">
          {activeTab === 'settings' && (
            <Button variant="primary" size="sm" loading={isSavingSettings} onClick={saveAllSettings}>
              <FloppyDiskIcon className="size-3.5" />
              保存全部设置
            </Button>
          )}
          <RefreshButton size="sm" aria-label="刷新" title="刷新" loading={loading} onClick={loadData} />
        </div>
      </div>

      {error && <Banner variant="error" title="加载失败" description={error} className="mb-4" />}

      {activeTab === 'overview' && (
        <div className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {statCards.map((card) => (
              <LayerCard key={card.label}>
                <LayerCard.Secondary>{card.label}</LayerCard.Secondary>
                <LayerCard.Primary className="text-3xl font-semibold">{card.value}</LayerCard.Primary>
              </LayerCard>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <LayerCard>
              <LayerCard.Secondary className="justify-between">
                近 7 天 AI 请求
                <span className="ml-auto text-xs font-normal text-kumo-subtle">
                  共 {aiTrendTotal} 次 · 成功率 {aiTrendSuccessRate}%
                </span>
              </LayerCard.Secondary>
              <LayerCard.Primary>
                {aiTrendTotal > 0 ? (
                  <Chart echarts={echarts} options={aiTrendOptions} height={260} />
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-kumo-subtle">
                    暂无 AI 请求数据
                  </div>
                )}
              </LayerCard.Primary>
            </LayerCard>
            <LayerCard>
              <LayerCard.Secondary>项目引擎分布</LayerCard.Secondary>
              <LayerCard.Primary>
                {projects.length > 0 ? (
                  <Chart echarts={echarts} options={engineDistributionOptions} height={260} />
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-kumo-subtle">
                    暂无项目数据
                  </div>
                )}
              </LayerCard.Primary>
            </LayerCard>
            <LayerCard className="lg:col-span-2">
              <LayerCard.Secondary>用户项目数 TOP 10</LayerCard.Secondary>
              <LayerCard.Primary>
                {users.length > 0 ? (
                  <Chart echarts={echarts} options={userProjectsOptions} height={280} />
                ) : (
                  <div className="flex h-40 items-center justify-center text-sm text-kumo-subtle">
                    暂无用户数据
                  </div>
                )}
              </LayerCard.Primary>
            </LayerCard>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <LayerCard className="overflow-auto">
          <Table>
            <Table.Header variant="compact">
              <Table.Row>
                <Table.Head>用户</Table.Head>
                <Table.Head>角色</Table.Head>
                <Table.Head>状态</Table.Head>
                <Table.Head>项目数</Table.Head>
                <Table.Head>上次登录</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {users.map((adminUser) => (
                <Table.Row key={adminUser.id}>
                  <Table.Cell>
                    <div className="font-medium">{adminUser.name || adminUser.username}</div>
                    <div className="text-sm text-kumo-subtle">{adminUser.username}</div>
                  </Table.Cell>
                  <Table.Cell>
                    <Select
                      aria-label={`${adminUser.username} 的角色`}
                      value={adminUser.role}
                      renderValue={(value) => displayRole(String(value))}
                      onValueChange={async (value) => {
                        try {
                          await AdminService.updateUser(adminUser.id, { role: String(value) as AdminUser['role'] })
                          showSuccess(`已将 ${adminUser.username} 的角色更新为 ${displayRole(String(value))}`)
                          await loadData()
                        } catch (err) {
                          showError(err instanceof Error ? err.message : '角色更新失败')
                        }
                      }}
                    >
                      <Select.Option value="admin">{displayRole('admin')}</Select.Option>
                      <Select.Option value="member">{displayRole('member')}</Select.Option>
                    </Select>
                  </Table.Cell>
                  <Table.Cell>
                    <Select
                      aria-label={`${adminUser.username} 的状态`}
                      value={adminUser.status}
                      renderValue={(value) => displayStatus(String(value))}
                      onValueChange={async (value) => {
                        try {
                          await AdminService.updateUser(adminUser.id, { status: String(value) as AdminUser['status'] })
                          showSuccess(`已将 ${adminUser.username} 的状态更新为 ${displayStatus(String(value))}`)
                          await loadData()
                        } catch (err) {
                          showError(err instanceof Error ? err.message : '状态更新失败')
                        }
                      }}
                    >
                      <Select.Option value="active">{displayStatus('active')}</Select.Option>
                      <Select.Option value="suspended">{displayStatus('suspended')}</Select.Option>
                    </Select>
                  </Table.Cell>
                  <Table.Cell>{adminUser.project_count}</Table.Cell>
                  <Table.Cell>{formatDate(adminUser.last_login_at)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </LayerCard>
      )}

      {activeTab === 'projects' && (
        <LayerCard className="overflow-auto">
          <Table>
            <Table.Header variant="compact">
              <Table.Row>
                <Table.Head>项目</Table.Head>
                <Table.Head>所有者</Table.Head>
                <Table.Head>引擎</Table.Head>
                <Table.Head>状态</Table.Head>
                <Table.Head>版本数</Table.Head>
                <Table.Head>更新时间</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {projects.map((project) => (
                <Table.Row key={project.id}>
                  <Table.Cell>
                    <div className="font-medium">{project.title}</div>
                    <div className="text-xs text-kumo-subtle">{project.id}</div>
                  </Table.Cell>
                  <Table.Cell>{project.owner_username}</Table.Cell>
                  <Table.Cell><Badge variant="teal">{project.engine_type}</Badge></Table.Cell>
                  <Table.Cell>{statusBadge(project.status)}</Table.Cell>
                  <Table.Cell>{project.version_count}</Table.Cell>
                  <Table.Cell>{formatDate(project.updated_at)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </LayerCard>
      )}

      {activeTab === 'settings' && (
        <div className="grid gap-4">
          <div className="columns-1 gap-4 lg:columns-2">
            {settings.map((setting) => {
              const draft = settingDrafts[setting.key] ?? setting.value
              return (
                <LayerCard key={setting.key} className="mb-4 break-inside-avoid">
                <LayerCard.Secondary className="justify-between pr-3">
                  <div className="font-medium text-kumo-default">{settingLabels[setting.key] ?? setting.key}</div>
                </LayerCard.Secondary>
                <LayerCard.Primary>
                {setting.key === 'ai.provider_defaults' ? (
                  <div className="grid gap-2">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                      <Select
                        aria-label="模型提供商"
                        value={providerDraft.provider}
                        onValueChange={(value) =>
                          setProviderDraft((current) => ({ ...current, provider: String(value) }))
                        }
                      >
                        <Select.Option value="openai">OpenAI 兼容接口</Select.Option>
                        <Select.Option value="anthropic">Anthropic</Select.Option>
                      </Select>
                      <Input
                        aria-label="API 基础地址"
                        placeholder="https://api.openai.com/v1"
                        value={providerDraft.baseUrl}
                        onChange={(event) =>
                          setProviderDraft((current) => ({ ...current, baseUrl: event.target.value }))
                        }
                        className="w-full"
                        autoComplete="off"
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                      <SensitiveInput
                        aria-label="API 密钥"
                        placeholder="sk-..."
                        value={providerDraft.apiKey}
                        onValueChange={(value) =>
                          setProviderDraft((current) => ({ ...current, apiKey: value }))
                        }
                        autoComplete="new-password"
                      />
                      {availableModels.length > 0 ? (
                        <Select
                          aria-label="默认模型"
                          value={providerDraft.modelId}
                          onValueChange={(value) =>
                            setProviderDraft((current) => ({ ...current, modelId: String(value) }))
                          }
                        >
                          {availableModels.map((model) => (
                            <Select.Option key={model} value={model}>
                              {model}
                            </Select.Option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          aria-label="默认模型 ID"
                          placeholder="gpt-4o"
                          value={providerDraft.modelId}
                          onChange={(event) =>
                            setProviderDraft((current) => ({ ...current, modelId: event.target.value }))
                          }
                          className="w-full"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={ArrowClockwiseIcon}
                        loading={isLoadingModels}
                        onClick={() => fetchModels(providerDraft, true)}
                      >
                        加载模型
                      </Button>
                      {isLoadingModels ? (
                        <span className="text-xs text-kumo-subtle">正在拉取模型列表…</span>
                      ) : (
                        availableModels.length > 0 && (
                          <span className="text-xs text-kumo-subtle">已加载 {availableModels.length} 个模型</span>
                        )
                      )}
                    </div>
                  </div>
                ) : setting.key === 'ai.daily_quota' ? (
                  <Input
                    aria-label="每日 AI 请求额度"
                    type="number"
                    min={0}
                    value={draft}
                    onChange={(event) =>
                      setSettingDrafts((current) => ({ ...current, [setting.key]: event.target.value }))
                    }
                    className="w-full"
                  />
                ) : setting.key === 'security.allow_registration' ? (
                  <Switch
                    label="允许新用户注册账号"
                    checked={draft === 'true'}
                    onCheckedChange={async (checked) => {
                      const next = String(checked)
                      setSettingDrafts((current) => ({ ...current, [setting.key]: next }))
                      try {
                        await AdminService.updateSetting(setting.key, checked)
                        await loadData()
                        showSuccess('设置「开放注册」已保存')
                      } catch (err) {
                        showError(err instanceof Error ? err.message : '设置保存失败')
                        setSettingDrafts((current) => ({ ...current, [setting.key]: draft }))
                      }
                    }}
                  />
                ) : setting.key === 'security.allow_public_access' ? (
                  <Switch
                    label="允许未登录用户访问工作区，关闭后必须登录才能使用"
                    checked={draft === 'true'}
                    onCheckedChange={async (checked) => {
                      const next = String(checked)
                      setSettingDrafts((current) => ({ ...current, [setting.key]: next }))
                      try {
                        await AdminService.updateSetting(setting.key, checked)
                        await loadData()
                        showSuccess('设置「公开访问」已保存')
                      } catch (err) {
                        showError(err instanceof Error ? err.message : '设置保存失败')
                        setSettingDrafts((current) => ({ ...current, [setting.key]: draft }))
                      }
                    }}
                  />
                ) : (
                  <Input
                    aria-label={`${settingLabels[setting.key] ?? setting.key} 的值`}
                    value={draft}
                    onChange={(event) =>
                      setSettingDrafts((current) => ({ ...current, [setting.key]: event.target.value }))
                    }
                    className="w-full"
                  />
                )}
                </LayerCard.Primary>
              </LayerCard>
            )
          })}
          </div>
        </div>
      )}

      {activeTab === 'usage' && (
        <LayerCard className="overflow-auto">
          <Table>
            <Table.Header variant="compact">
              <Table.Row>
                <Table.Head>用户</Table.Head>
                <Table.Head>服务商</Table.Head>
                <Table.Head>模型</Table.Head>
                <Table.Head>豁免</Table.Head>
                <Table.Head>创建时间</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {usage.map((record) => (
                <Table.Row key={record.id}>
                  <Table.Cell>{record.username || '访客'}</Table.Cell>
                  <Table.Cell>{record.provider}</Table.Cell>
                  <Table.Cell>{record.model_id || '-'}</Table.Cell>
                  <Table.Cell>
                    {record.exempt ? <Badge variant="success">是</Badge> : <Badge variant="neutral">否</Badge>}
                  </Table.Cell>
                  <Table.Cell>{formatDate(record.created_at)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </LayerCard>
      )}

      {activeTab === 'audit' && (
        <LayerCard className="overflow-auto">
          <Table>
            <Table.Header variant="compact">
              <Table.Row>
                <Table.Head>动作</Table.Head>
                <Table.Head>操作者</Table.Head>
                <Table.Head>目标</Table.Head>
                <Table.Head>详情</Table.Head>
                <Table.Head>创建时间</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {audit.map((record) => (
                <Table.Row key={record.id}>
                  <Table.Cell><Badge variant="outline">{actionLabels[record.action] ?? record.action}</Badge></Table.Cell>
                  <Table.Cell>{record.actor_username || '系统'}</Table.Cell>
                  <Table.Cell>{targetTypeLabels[record.target_type] ?? record.target_type}：{record.target_id || '-'}</Table.Cell>
                  <Table.Cell className="max-w-md truncate text-sm text-kumo-subtle">
                    {formatAuditMetadata(record.metadata)}
                  </Table.Cell>
                  <Table.Cell>{formatDate(record.created_at)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </LayerCard>
      )}
    </div>
  )
}
