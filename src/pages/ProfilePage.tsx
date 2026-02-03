import { useState, useEffect } from 'react'

import { Button, Input } from '@/components/ui'
import { quotaService, type LLMConfig } from '@/services/quotaService'
import { aiService } from '@/services/aiService'
import { useToast } from '@/hooks/useToast'
import { Settings, Eye, EyeOff, MessageCircle, Cpu, RefreshCw, RotateCw, ChevronDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/Dropdown'

export function ProfilePage() {
  const [activeTab] = useState('settings')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [quotaUsed, setQuotaUsed] = useState(0)
  const [quotaTotal, setQuotaTotal] = useState(10)
  const { success, error: showError } = useToast()

  // LLM 配置状态
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    modelId: '',
  })
  const [showApiKey, setShowApiKey] = useState(false)

  useEffect(() => {
    // 加载配额信息
    setQuotaUsed(quotaService.getUsedCount())
    setQuotaTotal(quotaService.getDailyQuota())
    // 加载已保存的密码
    setPassword(quotaService.getAccessPassword())
    // 加载已保存的 LLM 配置
    const savedConfig = quotaService.getLLMConfig()
    if (savedConfig) {
      setLlmConfig(savedConfig)
    }
  }, [])

  const handleSavePassword = () => {
    if (!password.trim()) {
      showError('请输入访问密码')
      return
    }
    quotaService.setAccessPassword(password.trim())
    success('访问密码已保存')
  }

  const handleResetPassword = () => {
    quotaService.clearAccessPassword()
    setPassword('')
    success('访问密码已清除')
  }

  const handleSaveLLMConfig = () => {
    if (!llmConfig.apiKey.trim()) {
      showError('请输入 API Key')
      return
    }
    if (!llmConfig.baseUrl.trim()) {
      showError('请输入 API Base URL')
      return
    }
    quotaService.setLLMConfig(llmConfig)
    success('LLM 配置已保存')
  }

  const handleResetLLMConfig = () => {
    quotaService.clearLLMConfig()
    setLlmConfig({
      provider: 'openai',
      baseUrl: '',
      apiKey: '',
      modelId: '',
    })
    success('LLM 配置已清除')
  }

  const quotaPercentage = Math.min(100, (quotaUsed / quotaTotal) * 100)
  const hasPassword = quotaService.hasAccessPassword()
  const hasLLMConfig = quotaService.hasLLMConfig()

  return (
    <div className="flex w-full flex-col bg-background">
      <main className="flex flex-1 flex-col items-center px-4 py-12">
        <div className="w-full max-w-2xl space-y-8">

          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Settings className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-primary">设置</h1>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-8">
            {/* 每日配额 */}
            <QuotaSection
              quotaUsed={quotaUsed}
              quotaTotal={quotaTotal}
              quotaPercentage={quotaPercentage}
              hasPassword={hasPassword}
              hasLLMConfig={hasLLMConfig}
            />

            {/* 分隔线 */}
            <div className="my-8 border-t border-border" />

            {/* 访问密码 */}
            <PasswordSection
              password={password}
              setPassword={setPassword}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              onSave={handleSavePassword}
              onReset={handleResetPassword}
            />

            {/* 分隔线 */}
            <div className="my-8 border-t border-border" />

            {/* LLM 配置 */}
            <LLMConfigSection
              config={llmConfig}
              setConfig={setLlmConfig}
              showApiKey={showApiKey}
              setShowApiKey={setShowApiKey}
              onSave={handleSaveLLMConfig}
              onReset={handleResetLLMConfig}
            />
          </div>
        </div>
      </main>
    </div>
  )
}

interface QuotaSectionProps {
  quotaUsed: number
  quotaTotal: number
  quotaPercentage: number
  hasPassword: boolean
  hasLLMConfig: boolean
}

function QuotaSection({ quotaUsed, quotaTotal, quotaPercentage, hasPassword, hasLLMConfig }: QuotaSectionProps) {
  const isUnlimited = hasPassword || hasLLMConfig
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-primary">每日配额</h3>
      <div className="space-y-3">
        {/* 进度条 */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-background">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${quotaPercentage}%` }}
          />
        </div>
        {/* 配额信息 */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">
            已使用 <span className="font-medium text-primary">{quotaUsed}</span> / {quotaTotal} 次
          </span>
          {isUnlimited && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
              无限制
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

interface PasswordSectionProps {
  password: string
  setPassword: (value: string) => void
  showPassword: boolean
  setShowPassword: (value: boolean) => void
  onSave: () => void
  onReset: () => void
}

function PasswordSection({
  password,
  setPassword,
  showPassword,
  setShowPassword,
  onSave,
  onReset,
}: PasswordSectionProps) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-primary">访问密码</h3>
      <div className="space-y-3">
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入访问密码"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-muted">
          输入正确的访问密码后，可无限制使用 AI 功能，不消耗每日配额。
        </p>

        <div className="flex gap-2">
          <Button size="sm" onClick={onSave}>
            保存
          </Button>
          <Button size="sm" variant="outline" onClick={onReset}>
            重置
          </Button>
        </div>
      </div>
    </div>
  )
}

interface LLMConfigSectionProps {
  config: LLMConfig
  setConfig: (config: LLMConfig) => void
  showApiKey: boolean
  setShowApiKey: (value: boolean) => void
  onSave: () => void
  onReset: () => void
}


function LLMConfigSection({
  config,
  setConfig,
  showApiKey,
  setShowApiKey,
  onSave,
  onReset,
}: LLMConfigSectionProps) {
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const { success, error: showError } = useToast()

  const handleFetchModels = async () => {
    if (!config.apiKey || !config.baseUrl) {
      showError('请先填写 API Key 和 API 地址')
      return
    }

    setIsLoadingModels(true)
    try {
      const models = await aiService.getModels(config)
      setAvailableModels(models)
      if (models.length > 0) {
        success(`成功获取 ${models.length} 个模型`)
        // 如果当前没有设置模型ID，或者设置的不在列表中，自动选择第一个
        if (!config.modelId && models.length > 0) {
          setConfig({ ...config, modelId: models[0] })
        }
      } else {
        showError('未找到可用模型')
      }
    } catch (err) {
      console.error(err)
      showError('获取模型列表失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setIsLoadingModels(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Cpu className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium text-primary">自定义 LLM 配置</h3>
      </div>
      <div className="space-y-3">
        {/* Provider 选择 */}
        <div>
          <label className="mb-1 block text-xs text-muted">API类型</label>
          <select
            value={config.provider}
            onChange={(e) => setConfig({ ...config, provider: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-primary focus:border-primary focus:outline-none"
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        {/* Base URL */}
        <div>
          <label className="mb-1 block text-xs text-muted"> API地址</label>
          <Input
            type="text"
            value={config.baseUrl}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
            placeholder="https://xxxxxxx/v1"
          />
        </div>

        {/* API Key */}
        <div>
          <label className="mb-1 block text-xs text-muted">API Key</label>
          <div className="relative">
            <Input
              type={showApiKey ? 'text' : 'password'}
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="sk-..."
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-primary"
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Model ID */}
        <div>
          <label className="mb-1 block text-xs text-muted">模型 ID</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type="text"
                value={config.modelId}
                onChange={(e) => setConfig({ ...config, modelId: e.target.value })}
                placeholder=""
                className="pr-8"
              />
              {availableModels.length > 0 && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex h-6 w-6 items-center justify-center text-muted hover:text-primary">
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-[300px] overflow-y-auto">
                      {availableModels.map((model) => (
                        <DropdownMenuItem
                          key={model}
                          onClick={() => setConfig({ ...config, modelId: model })}
                        >
                          {model}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
            <Button
              variant="outline"
              onClick={handleFetchModels}
              disabled={isLoadingModels}
              title="自动获取模型列表"
              className="h-10 w-10 flex-shrink-0 p-0"
            >
              {isLoadingModels ? <RotateCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted">
          配置自己的 LLM API 后，可无限制使用 AI 功能，不消耗每日配额。
          <br />
          <span className="text-yellow-600 dark:text-yellow-400">
            注意：如果同时设置了访问密码，将优先使用访问密码。
          </span>
        </p>

        <div className="flex gap-2">
          <Button size="sm" onClick={onSave}>
            保存
          </Button>
          <Button size="sm" variant="outline" onClick={onReset}>
            重置
          </Button>
        </div>
      </div>
    </div>
  )
}
