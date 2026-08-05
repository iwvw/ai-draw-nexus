import { Hono } from 'hono'
import type { LlmConfig, Message } from '../ai/types'
import { resolveAiEnv, callOpenAI, callAnthropic } from '../ai/providers'
import { streamOpenAI } from '../ai/stream-openai'
import { streamAnthropic } from '../ai/stream-anthropic'
import { getUserLlmConfig, getWorkspaceLlmConfig } from '../db/user-settings'
import { getRequestUser } from '../middleware/auth'

/**
 * Resolve the effective AI config for a request:
 * a preview config from the request body takes precedence over the
 * user's saved config (SQLite), which takes precedence over the
 * workspace defaults (SQLite settings), which takes precedence over process.env.
 */
function resolveConfigForUser(bodyConfig: LlmConfig | undefined, user: ReturnType<typeof getRequestUser>): LlmConfig | null {
  if (bodyConfig?.apiKey) return bodyConfig
  return getUserLlmConfig(user.id) ?? getWorkspaceLlmConfig()
}

const STATIC_ANTHROPIC_MODELS = [
  { id: 'claude-3-opus-20240229' },
  { id: 'claude-3-sonnet-20240229' },
  { id: 'claude-3-haiku-20240307' },
  { id: 'claude-3-5-sonnet-20240620' },
]

export const aiChatRouter = new Hono()

aiChatRouter.post('/', async (c) => {
  const user = getRequestUser(c)
  const body = await c.req.json().catch(() => null) as { messages?: Message[]; stream?: boolean; llmConfig?: LlmConfig } | null

  if (!body || !Array.isArray(body.messages)) {
    return c.json({ error: '请求无效：缺少消息列表' }, 400)
  }

  const env = resolveAiEnv(resolveConfigForUser(body.llmConfig, user))
  const provider = env.AI_PROVIDER
  const messages = body.messages

  if (body.stream) {
    try {
      const stream = provider === 'anthropic' ? streamAnthropic(messages, env) : streamOpenAI(messages, env)
      return new Response(stream as unknown as ReadableStream<Uint8Array>, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    } catch (error) {
      console.error('Chat stream init error:', error)
      return c.json({ error: error instanceof Error ? error.message : '未知错误' }, 500)
    }
  }

  try {
    const content =
      provider === 'anthropic' ? await callAnthropic(messages, env) : await callOpenAI(messages, env)
    return c.json({ content })
  } catch (error) {
    console.error('Chat error:', error)
    return c.json({ error: error instanceof Error ? error.message : '未知错误' }, 500)
  }
})

export const aiModelsRouter = new Hono()

aiModelsRouter.post('/', async (c) => {
  const user = getRequestUser(c)
  const body = await c.req.json().catch(() => ({})) as { llmConfig?: LlmConfig }
  const env = resolveAiEnv(resolveConfigForUser(body.llmConfig, user))

  if (env.AI_PROVIDER === 'anthropic') {
    return c.json({ data: STATIC_ANTHROPIC_MODELS })
  }

  const baseUrl = env.AI_BASE_URL.replace(/\/chat\/completions$/, '').replace(/\/$/, '')

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`获取模型列表失败：${response.status} ${errorText}`)
    }

    return c.json(await response.json())
  } catch (error) {
    console.error('Models API error:', error)
    return c.json({ error: error instanceof Error ? error.message : '未知错误' }, 500)
  }
})
