import type { LlmConfig } from './settingsService'
import { getAuthHeaders, apiUrl } from '@/lib/api'

interface ParseUrlResponse {
  success: boolean
  data?: {
    title: string
    content: string
    excerpt: string
    siteName: string
    url: string
  }
  error?: string
}

/**
 * AI Service for communicating with the backend.
 * Provider configuration is resolved server-side from the signed-in user's
 * saved settings (SQLite); the browser never stores API keys.
 * 生成已改为后端异步任务驱动（/api/generate-tasks），此处只保留
 * URL 解析与模型列表两个辅助接口。
 */
export const aiService = {
  /**
   * Parse URL content and convert to markdown
   */
  async parseUrl(url: string): Promise<ParseUrlResponse> {
    const response = await fetch(apiUrl('/parse-url'), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ url }),
    })

    const data: ParseUrlResponse = await response.json()

    if (!response.ok || !data.success) {
      throw new Error(data.error || '解析URL失败')
    }

    return data
  },

  /**
   * Get available models from the provider.
   * Uses the account's saved config (server-side); an optional preview config
   * can be passed before saving to test a new provider setup.
   */
  async getModels(previewConfig?: LlmConfig): Promise<string[]> {
    const headers = getAuthHeaders()

    const body: Record<string, unknown> = {}
    if (previewConfig) {
      body.llmConfig = previewConfig
    }

    const response = await fetch(apiUrl('/models'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`获取模型列表失败：${error}`)
    }

    const data = await response.json()
    // Handle OpenAI-compatible response format { data: [{ id: '...' }, ...] }
    if (data && Array.isArray(data.data)) {
      return data.data.map((model: { id: string }) => model.id)
    }

    return []
  }
}
