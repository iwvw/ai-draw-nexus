export type EngineType = 'drawio' | 'excalidraw' | 'mermaid'

export const ENGINE_VALUES = ['drawio', 'excalidraw', 'mermaid'] as const

export function inferEngine(content: string, filename?: string): EngineType {
  const name = (filename ?? '').toLowerCase()
  if (/\.(mmd|mermaid)$/i.test(name)) return 'mermaid'
  if (/\.excalidraw$/i.test(name)) return 'excalidraw'
  if (/\.(drawio|xml)$/i.test(name)) return 'drawio'
  const trimmed = content.trimStart()
  if (trimmed.startsWith('<mxGraphModel') || trimmed.startsWith('<mxfile')) return 'drawio'
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed.type === 'excalidraw' || Array.isArray(parsed.elements)) return 'excalidraw'
    } catch {
      // 非 JSON，按 mermaid 处理
    }
  }
  return 'mermaid'
}