/**
 * Validators for different diagram engine outputs
 */

import type { EngineType } from '@/types'

export interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * Mermaid code validator
 * Uses mermaid.parse() for syntax validation
 */
export async function validateMermaid(code: string): Promise<ValidationResult> {
  try {
    const mermaid = await import('mermaid')
    await mermaid.default.parse(normalizeMermaidCode(code))
    return { valid: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Mermaid 语法无效'
    return { valid: false, error: message }
  }
}

/**
 * Normalize common Mermaid generation glitches before validation.
 * The most frequent failure is the AI gluing a comment/classDef directly
 * onto the flowchart declaration line (e.g. `flowchart TB%% 样式定义classDef main`),
 * which Mermaid parses as a single invalid token. We split the stuck bits onto
 * their own lines so parsing (and rendering) succeeds.
 */
export function normalizeMermaidCode(code: string): string {
  let out = code
  // Case 1: declaration immediately followed by `%%`.
  // Example: `flowchart TB%% 样式定义classDef main` -> split onto its own line.
  out = out.replace(
    /^(flowchart\s+(?:TB|LR|TD|RL|BT))\s*%%/gim,
    '$1\n%%\n'
  )
  // Case 2: mixed edge symbols that Mermaid cannot parse.
  // `A -- "文本" -.-> B` -> `A -. "文本" .-> B`
  out = out.replace(/--(\s*"[^"]*")\s*-\s*\.->/g, '-.$1 .->')
  // `A -- "文本" ==> B` -> `A == "文本" ==> B`
  out = out.replace(/--(\s*"[^"]*")\s*==>/g, '==$1 ==>')
  // bare mixed: `A -- -.-> B` / `A -- ==> B`
  out = out.replace(/--\s*-\s*\.->/g, '-.->')
  out = out.replace(/--\s*==>/g, '==>')
  // Case 4: 带引号 label 的虚线/粗线边非法（引号仅 `--`/`-->| |` 合法）。
  // `A == "文本" ==> B` -> `A == 文本 ==> B`；`A -. "文本" .-> B` -> `A -. 文本 .-> B`
  out = out.replace(/==\s*"([^"]*)"\s*==>/g, '== $1 ==>')
  out = out.replace(/-\.\s*"([^"]*)"\s*\.->/g, '-. $1 .->')
  // subgraph `end` 粘连：行尾含边又粘着 `end`（如 `A ==> B["..."]    end`）拆为独立 `end` 行。
  out = out
    .split('\n')
    .map((ln) => {
      const t = ln.trim()
      if (t.endsWith('end') && /-->|--|==>|==|-\.->/.test(t.replace(/\s*end\s*$/, ''))) {
        const prefix = ln.replace(/\s*end\s*$/, '')
        return prefix + '\nend'
      }
      return ln
    })
    .join('\n')
  return out
}

/**
 * Excalidraw JSON validator
 * Validates JSON format and required fields
 * Supports both array format (direct elements) and object format (with type/elements fields)
 */
export function validateExcalidraw(json: string): ValidationResult {
  try {
    const data = JSON.parse(json)

    // Determine elements array - support both formats:
    // 1. Direct array: [{ id, type, x, y, ... }, ...]
    // 2. Object format: { type: "excalidraw", elements: [...] }
    let elements: unknown[]

    if (Array.isArray(data)) {
      // Direct array format (AI-generated)
      elements = data
    } else if (data && typeof data === 'object') {
      // Object format with elements field
      if (!Array.isArray(data.elements)) {
        return { valid: false, error: '缺少或无效的 elements 数组' }
      }
      elements = data.elements
    } else {
      return { valid: false, error: '格式无效：需要数组，或包含 elements 的对象' }
    }

    // Validate each element has required properties
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as Record<string, unknown>

      // id is optional - Excalidraw will auto-generate if missing
      if (!el.type) {
        return { valid: false, error: `第 ${i + 1} 个元素缺少 type 字段` }
      }
      if (typeof el.x !== 'number' || typeof el.y !== 'number') {
        return { valid: false, error: `第 ${i + 1} 个元素缺少有效的 x/y 坐标` }
      }
    }

    return { valid: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'JSON 格式无效'
    return { valid: false, error: message }
  }
}

/**
 * Drawio XML validator
 * Validates XML format and mxGraphModel structure
 */
export function validateDrawio(xml: string): ValidationResult {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'text/xml')

    // Check for parsing errors
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      return { valid: false, error: 'XML 格式无效：' + parseError.textContent }
    }

    // Check for mxGraphModel root element
    const mxGraphModel = doc.querySelector('mxGraphModel')
    if (!mxGraphModel) {
      return { valid: false, error: '缺少 mxGraphModel 根节点' }
    }

    // Check for root element within mxGraphModel
    const root = mxGraphModel.querySelector('root')
    if (!root) {
      return { valid: false, error: 'mxGraphModel 中缺少 root 节点' }
    }

    // Check for at least one mxCell
    const mxCells = root.querySelectorAll('mxCell')
    if (mxCells.length === 0) {
      return { valid: false, error: '未找到 mxCell 元素' }
    }

    return { valid: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'XML 格式无效'
    return { valid: false, error: message }
  }
}

/**
 * Validate content based on engine type
 */
export async function validateContent(
  content: string,
  engineType: EngineType
): Promise<ValidationResult> {
  switch (engineType) {
    case 'mermaid':
      return validateMermaid(content)
    case 'excalidraw':
      return validateExcalidraw(content)
    case 'drawio':
      return validateDrawio(content)
    default:
      return { valid: false, error: `未知绘图引擎：${engineType}` }
  }
}
