import type { PayloadMessage, ChatRequest } from '@/types'
import { quotaService } from './quotaService'

// API endpoint - can be configured via environment variable
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

/**
 * 获取请求头（包含访问密码和 LLM 配置）
 */
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  // 优先使用访问密码
  const password = quotaService.getAccessPassword()
  if (password) {
    headers['X-Access-Password'] = password
  }
  // 如果没有访问密码，检查是否有自定义 LLM 配置
  const llmConfig = quotaService.getLLMConfig()
  if (llmConfig && llmConfig.apiKey) {
    headers['X-Custom-LLM'] = 'true'
  }
  return headers
}

/**
 * 检查配额并在需要时消耗
 */
function checkAndConsumeQuota(response: Response): void {
  const quotaExempt = response.headers.get('X-Quota-Exempt')
  // 只有当不免除配额时才消耗
  if (quotaExempt !== 'true') {
    quotaService.consumeQuota()
  }
}

/**
 * 检查是否有足够配额（有密码或自定义 LLM 配置时跳过检查）
 */
function ensureQuotaAvailable(): void {
  // 优先检查访问密码，其次检查 LLM 配置
  if (quotaService.hasAccessPassword() || quotaService.hasLLMConfig()) {
    return
  }
  if (!quotaService.hasQuotaRemaining()) {
    throw new Error('今日配额已用完，请明天再试或设置访问密码/自定义 LLM 配置')
  }
}

/**
 * 构建请求体（包含 LLM 配置，如果有的话）
 */
function buildRequestBody(messages: PayloadMessage[], stream = false): object {
  const body: Record<string, unknown> = { messages, stream }

  // 如果没有访问密码但有自定义 LLM 配置，则添加到请求体
  if (!quotaService.hasAccessPassword() && quotaService.hasLLMConfig()) {
    const llmConfig = quotaService.getLLMConfig()
    if (llmConfig) {
      body.llmConfig = llmConfig
    }
  }

  return body
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
 * AI Service for communicating with the backend
 */
export const aiService = {
  /**
   * Send chat messages to AI and get response (non-streaming)
   */
  async chat(messages: PayloadMessage[]): Promise<string> {
    ensureQuotaAvailable()

    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(buildRequestBody(messages, false)),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`AI request failed: ${error}`)
    }

    checkAndConsumeQuota(response)

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
    ensureQuotaAvailable()

    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(buildRequestBody(messages, true)),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`AI request failed: ${error}`)
    }

    // 流式请求成功后检查并消耗配额
    checkAndConsumeQuota(response)

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Failed to get response reader')
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
   * Get available models from the provider
   */
  async getModels(customConfig?: { baseUrl: string; apiKey: string; provider: string }): Promise<string[]> {
    const headers = getHeaders()

    // Construct body with optional custom config
    const body: Record<string, unknown> = {}
    if (customConfig) {
      body.llmConfig = customConfig
    } else if (quotaService.hasLLMConfig()) {
      body.llmConfig = quotaService.getLLMConfig()
    }

    const response = await fetch(`${API_BASE_URL}/models`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to fetch models: ${error}`)
    }

    const data = await response.json()
    // Handle OpenAI-compatible response format { data: [{ id: '...' }, ...] }
    if (data && Array.isArray(data.data)) {
      return data.data.map((model: { id: string }) => model.id)
    }

    return []
  }
}
