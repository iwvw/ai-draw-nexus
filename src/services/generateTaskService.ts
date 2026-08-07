import { useAuthStore } from '@/stores/authStore'
import type { EngineType } from '@/types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = useAuthStore.getState().token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export interface GenerateTask {
  task_id: string
  project_id?: string
  engine_type: string
  status: 'pending' | 'running' | 'done' | 'error'
  content?: string
  error?: string
}

/**
 * 提交后端异步生成任务，立即返回 task_id。
 * 前端不组装提示词/不外发 API key——全部由后端 gen 包完成。
 */
export async function submitGenerateTask(params: {
  projectId: string
  engine: EngineType
  prompt: string
  changeSummary?: string
}): Promise<{ task_id: string; project_id: string; status: string }> {
  const res = await fetch(`${API_BASE_URL}/generate-tasks/`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({
      project_id: params.projectId,
      engine_type: params.engine,
      prompt: params.prompt,
      change_summary: params.changeSummary,
    }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`提交生成任务失败：${err}`)
  }
  return res.json()
}

/**
 * 轮询任务状态。
 */
export async function getGenerateTask(taskId: string): Promise<GenerateTask> {
  const res = await fetch(`${API_BASE_URL}/generate-tasks/${taskId}`, { headers: getAuthHeaders() })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`查询任务失败：${err}`)
  }
  return res.json()
}

/**
 * 轮询直至 done 或 error，返回最终任务。
 * @param timeoutMs 可选超时（默认 180s）
 */
export async function pollGenerateTask(
  taskId: string,
  intervalMs = 1200,
  timeoutMs = 1_800_000,
  onTick?: (t: GenerateTask) => void
): Promise<GenerateTask> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const t = await getGenerateTask(taskId)
    onTick?.(t)
    if (t.status === 'done' || t.status === 'error') return t
    if (Date.now() > deadline) {
      throw new Error('生成任务超时')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}