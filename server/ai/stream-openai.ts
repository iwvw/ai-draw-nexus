import type { Message } from './types'
import type { EffectiveEnv } from './providers'

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
      const delta = json.choices?.[0]?.delta
      if (delta?.content) text += delta.content
    } catch {
      // ignore malformed chunks
    }
  }
  return text
}

export function streamOpenAI(messages: Message[], env: EffectiveEnv): ReadableStream<string> {
  const baseUrl = env.AI_BASE_URL
  const apiKey = env.AI_API_KEY

  if (!apiKey) {
    throw new Error('未配置 AI_API_KEY')
  }

  return new ReadableStream({
    async start(controller) {
      try {
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
            stream: true,
          }),
        })

        if (!response.ok || !response.body) {
          const error = await response.text()
          throw new Error(`OpenAI API 错误：${error}`)
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
