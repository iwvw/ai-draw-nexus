import type { PayloadMessage } from '@/types'
import { useAuthStore } from '@/stores/authStore'
import type { LlmConfig } from './settingsService'

// API endpoint - can be configured via environment variable
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

/**
 * 获取请求头（仅携带认证）
 * 配额与服务端 LLM 配置均由后端从 SQLite 读取，浏览器不再保存任何配置。
 */
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = useAuthStore.getState().token
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

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
 * Parse SSE data line and extract content
 */
function parseSSELine(line: string): string | null {
  let data = line

  // Handle SSE format (data: prefix)
  if (line.startsWith('data: ')) {
    data = line.slice(6)
  }

  if (data === '[DONE]') return null

  try {
    const parsed = JSON.parse(data)
    // Handle OpenAI format
    if (parsed.choices?.[0]?.delta?.content) {
      return parsed.choices[0].delta.content
    }
    // Handle simple format
    if (parsed.content) {
      return parsed.content
    }
    // Handle text field
    if (parsed.text) {
      return parsed.text
    }
  } catch {
    // Not JSON, return raw data if it has content
    if (data.trim()) {
      return data
    }
  }
  return null
}

/**
 * AI Service for communicating with the backend.
 * Provider configuration is resolved server-side from the signed-in user's
 * saved settings (SQLite); the browser never stores API keys.
 */
export const aiService = {
  /**
   * Send chat messages to AI and get response (non-streaming)
   */
  async chat(messages: PayloadMessage[]): Promise<string> {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ messages, stream: false }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`AI 请求失败：${error}`)
    }

    const data = await response.json()
    return data.content || data.message || ''
  },

  /**
   * Stream chat response with SSE support
   * @param messages - The messages to send
   * @param onChunk - Callback for each content chunk
   * @param onComplete - Optional callback when streaming completes
   * @returns The full accumulated content
   */
  async streamChat(
    messages: PayloadMessage[],
    onChunk: (chunk: string, accumulated: string) => void,
    onComplete?: (content: string) => void
  ): Promise<string> {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ messages, stream: true }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`AI 请求失败：${error}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('无法读取 AI 响应流')
    }

    const decoder = new TextDecoder()
    let fullContent = ''
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete lines
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine) continue

          const content = parseSSELine(trimmedLine)
          if (content) {
            fullContent += content
            onChunk(content, fullContent)
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const content = parseSSELine(buffer.trim())
        if (content) {
          fullContent += content
          onChunk(content, fullContent)
        }
      }
    } finally {
      reader.releaseLock()
    }

    onComplete?.(fullContent)
    return fullContent
  },

  /**
   * Parse URL content and convert to markdown
   */
  async parseUrl(url: string): Promise<ParseUrlResponse> {
    const response = await fetch(`${API_BASE_URL}/parse-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const headers = getHeaders()

    const body: Record<string, unknown> = {}
    if (previewConfig) {
      body.llmConfig = previewConfig
    }

    const response = await fetch(`${API_BASE_URL}/models`, {
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
