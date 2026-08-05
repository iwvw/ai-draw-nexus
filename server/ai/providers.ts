import type { Message, ContentPart, AnthropicContentPart, OpenAIResponse, AnthropicResponse, LlmConfig } from './types'

export interface EffectiveEnv {
  AI_PROVIDER: string
  AI_BASE_URL: string
  AI_API_KEY: string
  AI_MODEL_ID: string
}

/**
 * Resolve the effective AI environment:
 * workspace defaults from process.env, overridden by the user's saved config.
 */
export function resolveAiEnv(config?: LlmConfig | null): EffectiveEnv {
  const base: EffectiveEnv = {
    AI_PROVIDER: process.env.AI_PROVIDER || 'openai',
    AI_BASE_URL: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    AI_API_KEY: process.env.AI_API_KEY || '',
    AI_MODEL_ID: process.env.AI_MODEL_ID || 'gpt-4o-mini',
  }

  if (!config || !config.apiKey) return base

  return {
    AI_PROVIDER: config.provider || base.AI_PROVIDER,
    AI_BASE_URL: config.baseUrl || base.AI_BASE_URL,
    AI_API_KEY: config.apiKey,
    AI_MODEL_ID: config.modelId || base.AI_MODEL_ID,
  }
}

export function convertContentPartsToAnthropic(parts: ContentPart[]): AnthropicContentPart[] {
  return parts
    .map((part) => {
      if (part.type === 'text') {
        return { type: 'text' as const, text: part.text || '' }
      }
      if (part.type === 'image_url' && part.image_url?.url) {
        const url = part.image_url.url
        if (url.startsWith('data:')) {
          const matches = url.match(/^data:(image\/[^;]+);base64,(.+)$/)
          if (matches) {
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: matches[1],
                data: matches[2],
              },
            }
          }
        }
        return { type: 'text' as const, text: `[Image URL: ${url}]` }
      }
      return { type: 'text' as const, text: '' }
    })
    .filter((part) => part.type === 'image' || (part.type === 'text' && part.text))
}

export async function callOpenAI(messages: Message[], env: EffectiveEnv): Promise<string> {
  const baseUrl = env.AI_BASE_URL
  const apiKey = env.AI_API_KEY

  if (!apiKey) {
    throw new Error('未配置 AI_API_KEY')
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: env.AI_MODEL_ID,
      messages: messages,
      max_tokens: 64000,
      stream: false,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API 错误：${error}`)
  }

  const data: OpenAIResponse = await response.json()
  return data.choices[0]?.message?.content || ''
}

export async function callAnthropic(messages: Message[], env: EffectiveEnv): Promise<string> {
  const baseUrl = env.AI_BASE_URL
  const apiKey = env.AI_API_KEY

  if (!apiKey) {
    throw new Error('未配置 AI_API_KEY')
  }

  const systemMessage = messages.find((m) => m.role === 'system')
  const nonSystemMessages = messages.filter((m) => m.role !== 'system')

  const anthropicMessages = nonSystemMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: typeof m.content === 'string' ? m.content : convertContentPartsToAnthropic(m.content),
  }))

  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.AI_MODEL_ID,
      max_tokens: 64000,
      system: typeof systemMessage?.content === 'string' ? systemMessage.content : '',
      messages: anthropicMessages,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Anthropic API 错误：${error}`)
  }

  const data: AnthropicResponse = await response.json()
  return data.content[0]?.text || ''
}
