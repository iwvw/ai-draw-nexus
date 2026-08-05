import type { Message } from './types'
import type { EffectiveEnv } from './providers'
import { convertContentPartsToAnthropic } from './providers'

function extractChunkText(chunk: string): string {
  if (!chunk.trim()) return ''
  const lines = chunk
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s*/, '').trim())

  let text = ''
  for (const line of lines) {
    if (line === '[DONE]') continue
    try {
      const json = JSON.parse(line)
      if (json.type === 'content_block_delta') {
        if (json.delta?.type === 'text_delta' && json.delta.text) {
          text += json.delta.text
        } else if (json.delta?.type === 'text' && json.delta.text) {
          text += json.delta.text
        }
      }
    } catch {
      // ignore malformed chunks
    }
  }
  return text
}

export function streamAnthropic(messages: Message[], env: EffectiveEnv): ReadableStream<string> {
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

  return new ReadableStream({
    async start(controller) {
      try {
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
            stream: true,
            system: typeof systemMessage?.content === 'string' ? systemMessage.content : '',
            messages: anthropicMessages,
          }),
        })

        if (!response.ok || !response.body) {
          const error = await response.text()
          throw new Error(`Anthropic API 错误：${error}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const chunks = buffer.split('\n\n')
          buffer = chunks.pop() || ''

          for (const chunk of chunks) {
            const text = extractChunkText(chunk)
            if (text) {
              controller.enqueue(text)
            }
          }
        }

        const remainder = extractChunkText(buffer)
        if (remainder) controller.enqueue(remainder)
      } catch (err) {
        controller.error(err)
      } finally {
        controller.close()
      }
    },
  })
}
