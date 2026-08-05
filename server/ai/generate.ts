import type { Message, LlmConfig } from './types'
import { resolveAiEnv, callOpenAI, callAnthropic } from './providers'
import { getUserLlmConfig, getWorkspaceLlmConfig } from '../db/user-settings'
import { drawioSystemPrompt, excalidrawSystemPrompt, mermaidSystemPrompt } from './prompts'

export type EngineType = 'drawio' | 'excalidraw' | 'mermaid'

const SYSTEM_PROMPTS: Record<EngineType, string> = {
  mermaid: mermaidSystemPrompt,
  drawio: drawioSystemPrompt,
  excalidraw: excalidrawSystemPrompt,
}

const CODE_BLOCK_PATTERNS: Record<EngineType, RegExp[]> = {
  mermaid: [/```mermaid\n?([\s\S]*?)```/i, /```\n?([\s\S]*?)```/],
  drawio: [/```xml\n?([\s\S]*?)```/i, /```\n?([\s\S]*?)```/],
  excalidraw: [/```json\n?([\s\S]*?)```/i, /```\n?([\s\S]*?)```/],
}

export function extractCode(response: string, engineType: EngineType): string {
  let code = response.trim()
  for (const pattern of CODE_BLOCK_PATTERNS[engineType]) {
    const match = code.match(pattern)
    if (match) {
      code = match[1].trim()
      break
    }
  }
  return code
}

export interface GenerateDiagramOptions {
  prompt: string
  engineType: EngineType
  currentContent?: string
  llmConfig?: LlmConfig
}

export interface GenerateDiagramResult {
  content: string
  engineType: EngineType
}

/**
 * Generate or edit a diagram through the configured LLM (non-streaming).
 * Reuses the user's saved LLM config, then workspace defaults, then env.
 */
export async function generateDiagram(
  options: GenerateDiagramOptions,
  userId: string,
): Promise<GenerateDiagramResult> {
  const env = resolveAiEnv(options.llmConfig ?? getUserLlmConfig(userId) ?? getWorkspaceLlmConfig())
  const provider = env.AI_PROVIDER

  const userContent = options.currentContent
    ? `当前图表内容：
"""
${options.currentContent}
"""

用户修改请求："""${options.prompt}"""

根据用户修改请求进行修改，同时尽量保持原有结构不变。输出完整的修改后的图表代码。`
    : `用户需求：
"""
${options.prompt}
"""

根据以上需求，生成完整的图表代码。`

  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPTS[options.engineType] },
    { role: 'user', content: userContent },
  ]

  const raw = provider === 'anthropic' ? await callAnthropic(messages, env) : await callOpenAI(messages, env)
  return { content: extractCode(raw, options.engineType), engineType: options.engineType }
}
