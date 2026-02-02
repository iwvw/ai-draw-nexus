import { corsHeaders, handleCors } from './_shared/cors'
import { validateAccessPassword } from './_shared/auth'
import { createEffectiveEnv } from './_shared/ai-providers'
import { LLMConfig } from './_shared/types'

export const config = {
    runtime: 'edge',
}

interface OpenAIModel {
    id: string
    object: string
    created: number
    owned_by: string
}

interface OpenAIModelsResponse {
    object: string
    data: OpenAIModel[]
}

export const onRequest = async (context: any) => {
    const request = context.request as Request
    // Handle CORS
    const corsResponse = handleCors(request)
    if (corsResponse) return corsResponse

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    try {
        const { valid } = validateAccessPassword(request, context.env)
        if (!valid) {
            return new Response(JSON.stringify({ error: '访问密码错误' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        const body = await request.json() as { llmConfig?: LLMConfig }
        const { llmConfig } = body

        // 获取有效的环境配置 (优先使用前端传入的 llmConfig)
        const effectiveEnv = createEffectiveEnv(context.env, llmConfig)

        // 如果是 Anthropic，目前没有标准 models 列表接口，返回静态列表或错误
        if (effectiveEnv.AI_PROVIDER === 'anthropic') {
            return new Response(JSON.stringify({
                data: [
                    { id: 'claude-3-opus-20240229' },
                    { id: 'claude-3-sonnet-20240229' },
                    { id: 'claude-3-haiku-20240307' },
                    { id: 'claude-3-5-sonnet-20240620' }
                ]
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        // OpenAI 兼容接口
        const baseUrl = effectiveEnv.AI_BASE_URL.replace(/\/chat\/completions$/, '').replace(/\/$/, '')
        // 确保 baseUrl 不包含 /chat/completions (虽然 createEffectiveEnv 返回的通常是 v1)

        const response = await fetch(`${baseUrl}/models`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${effectiveEnv.AI_API_KEY}`,
                'Content-Type': 'application/json',
            },
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Failed to fetch models: ${response.status} ${errorText}`)
        }

        const data = await response.json()
        return new Response(JSON.stringify(data), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })

    } catch (error) {
        console.error('Models API error:', error)
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
}
