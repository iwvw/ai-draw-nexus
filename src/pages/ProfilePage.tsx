import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Input, LayerCard, Meter, Select, SensitiveInput } from '@cloudflare/kumo'
import {
  ArrowClockwiseIcon,
  CpuIcon,
  FloppyDiskIcon,
  GaugeIcon,
  GearSixIcon,
  SignOutIcon,
  UserCircleIcon,
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

export function ProfilePage() {
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(defaultLlmConfig)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [quotaUsed, setQuotaUsed] = useState(0)
  const [quotaTotal, setQuotaTotal] = useState(10)

  const { success, error: showError } = useToast()
  const { user, isAuthenticated, logout } = useAuthStore()
  const navigate = useNavigate()

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
