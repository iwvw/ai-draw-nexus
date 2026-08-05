import { db } from './sqlite'

export interface LlmConfig {
  provider: string
  baseUrl: string
  apiKey: string
  modelId: string
}

export const USER_SETTING_KEYS = ['llm.config', 'ui.preferences'] as const

function getSettingRaw(userId: string, key: string): string | null {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function getUserLlmConfig(userId: string): LlmConfig | null {
  const raw = getSettingRaw(userId, 'llm.config')
  if (!raw) return null
  const parsed = parseJson<LlmConfig>(raw, {
    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    modelId: '',
  })
  return parsed.apiKey ? parsed : null
}

export function getWorkspaceLlmConfig(): LlmConfig | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai.provider_defaults'").get() as
    | { value: string }
    | undefined
  const parsed = parseJson<LlmConfig>(row?.value ?? null, {
    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    modelId: '',
  })
  return parsed.apiKey ? parsed : null
}

export function getDailyQuota(): number {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'ai.daily_quota'").get() as
    | { value: string }
    | undefined
  const parsed = Number(setting?.value ?? process.env.DAILY_QUOTA ?? 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10
}
