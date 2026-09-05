import { getAuthHeaders, apiUrl } from '@/lib/api'

export interface LlmConfig {
  provider: string // 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  modelId: string
}

export interface UiPreferences {
  chatPanelCollapsed?: boolean
}

export const SettingsService = {
  /**
   * Load the signed-in user's settings from the server
   */
  async getAll(): Promise<{ 'llm.config'?: LlmConfig; 'ui.preferences'?: UiPreferences }> {
    const res = await fetch(apiUrl('/settings'), { headers: getAuthHeaders() })
    if (!res.ok) return {}
    return res.json()
  },

  async getLlmConfig(): Promise<LlmConfig | null> {
    const all = await this.getAll()
    return all['llm.config'] ?? null
  },

  async getUiPreferences(): Promise<UiPreferences> {
    const all = await this.getAll()
    return all['ui.preferences'] ?? {}
  },

  async saveLlmConfig(config: LlmConfig): Promise<void> {
    const res = await fetch(apiUrl('/settings'), {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ key: 'llm.config', value: config }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || '设置保存失败')
    }
  },

  async clearLlmConfig(): Promise<void> {
    await fetch(apiUrl('/settings/llm.config'), {
      method: 'DELETE',
      headers: getAuthHeaders(),
    })
  },

  async saveUiPreferences(prefs: UiPreferences): Promise<void> {
    const res = await fetch(apiUrl('/settings'), {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ key: 'ui.preferences', value: prefs }),
    })
    if (!res.ok) {
      console.error('Failed to save UI preferences', await res.text().catch(() => ''))
    }
  },
}

export interface TodayUsage {
  used: number
  quota: number
  date: string
}

export const UsageService = {
  /**
   * Server-side daily AI usage for the signed-in user
   */
  async getToday(): Promise<TodayUsage> {
    const res = await fetch(apiUrl('/usage/today'), { headers: getAuthHeaders() })
    if (!res.ok) return { used: 0, quota: 10, date: '' }
    return res.json()
  },
}
