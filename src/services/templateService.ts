import type { DiagramTemplate, EngineType, TemplateScope, TemplateType } from '@/types'
import { useAuthStore } from '@/stores/authStore'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = useAuthStore.getState().token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

interface CloudTemplate {
  id: string
  code: string
  name: string
  description: string
  type: TemplateType
  engine_type: EngineType
  scope: TemplateScope
  content: string
  owner_id: string | null
  created_at: string
  updated_at: string
}

function mapTemplate(t: CloudTemplate): DiagramTemplate {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    type: t.type,
    engineType: t.engine_type,
    scope: t.scope,
    content: t.content,
    ownerId: t.owner_id,
    createdAt: new Date(t.created_at),
    updatedAt: new Date(t.updated_at),
  }
}

export const TemplateService = {
  async list(params?: { engineType?: EngineType; type?: TemplateType }): Promise<DiagramTemplate[]> {
    const qs = new URLSearchParams()
    if (params?.engineType) qs.set('engine_type', params.engineType)
    if (params?.type) qs.set('type', params.type)
    const res = await fetch(`${API_BASE_URL}/templates/?${qs.toString()}`, { headers: getAuthHeaders() })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || '获取模板失败')
    }
    const data = await res.json()
    return (data.templates ?? []).map(mapTemplate)
  },

  async create(input: {
    code: string
    name: string
    description?: string
    type: TemplateType
    engineType: EngineType
    scope?: TemplateScope
    content: string
  }): Promise<DiagramTemplate> {
    const res = await fetch(`${API_BASE_URL}/templates/`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        code: input.code,
        name: input.name,
        description: input.description ?? '',
        type: input.type,
        engine_type: input.engineType,
        scope: input.scope ?? 'private',
        content: input.content,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || '创建模板失败')
    }
    return mapTemplate(await res.json())
  },

  async update(
    id: string,
    input: { name?: string; description?: string; type?: TemplateType; content?: string },
  ): Promise<DiagramTemplate> {
    const res = await fetch(`${API_BASE_URL}/templates/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || '更新模板失败')
    }
    return mapTemplate(await res.json())
  },

  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/templates/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || '删除模板失败')
    }
  },
}