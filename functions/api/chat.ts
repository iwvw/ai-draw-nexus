import type { ChatRequest } from './_shared/types'
import { corsHeaders, handleCors } from './_shared/cors'
import { validateAccessPassword } from './_shared/auth'
import { callOpenAI, callAnthropic, createEffectiveEnv } from './_shared/ai-providers'
import { streamOpenAI } from './_shared/stream-openai'
import { streamAnthropic } from './_shared/stream-anthropic'

export const config = {
  runtime: 'edge',
}

export const onRequest = async (context: any) => {
  const request = context.request as Request
  // Handle CORS preflight
  const corsResponse = handleCors(request)
  if (corsResponse) return corsResponse

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { valid, exempt } = validateAccessPassword(request, context.env)
    if (!valid) {
      return new Response(JSON.stringify({ error: '访问密码错误' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body: ChatRequest = await request.json()
    const { messages, stream = false, llmConfig } = body

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Invalid request: messages required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 使用自定义 LLM 配置时也免除配额
    const hasCustomLLM = !!(llmConfig && llmConfig.apiKey)
    const effectiveExempt = exempt || hasCustomLLM
    const effectiveEnv = createEffectiveEnv(context.env, llmConfig)
    const provider = effectiveEnv.AI_PROVIDER || 'openai'
    const quotaHeaders = { ...corsHeaders, 'X-Quota-Exempt': effectiveExempt ? 'true' : 'false' }

    if (stream) {
      switch (provider) {
        case 'anthropic':
          return streamAnthropic(messages, effectiveEnv, effectiveExempt)
        case 'openai':
        default:
          return streamOpenAI(messages, effectiveEnv, effectiveExempt)
      }
    } else {
      let response: string

      switch (provider) {
        case 'anthropic':
          response = await callAnthropic(messages, effectiveEnv)
          break
        case 'openai':
        default:
          response = await callOpenAI(messages, effectiveEnv)
          break
      }

      return new Response(JSON.stringify({ content: response }), {
        headers: { ...quotaHeaders, 'Content-Type': 'application/json' },
      })
    }
  } catch (error) {
    console.error('Chat error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}
