import type { Project, EngineType } from '@/types'
import { useAuthStore } from '@/stores/authStore'

/**
 * Helper to get auth headers
 */
const getAuthHeaders = (): Record<string, string> => {
  const token = useAuthStore.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

/**
 * Project Repository
 * Data access layer for project management.
 * All projects are stored in the workspace SQLite database, scoped to the
 * signed-in account. No browser-local persistence is used.
 */
export const ProjectService = {
  /**
   * Create a new project
   */
  async create(data: {
    title: string
    engineType: EngineType
    thumbnail?: string
  }): Promise<Project> {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        title: data.title,
        engine_type: data.engineType,
        thumbnail: data.thumbnail
      })
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || '云端保存失败')
    }

    const cloud = await res.json()
    const now = new Date()
    return {
      id: cloud.id,
      title: data.title,
      engineType: data.engineType,
      thumbnail: data.thumbnail || '',
      createdAt: now,
      updatedAt: now,
    }
  },

  /**
   * Get project by ID
   */
  async getById(id: string): Promise<Project | undefined> {
    const res = await fetch(`/api/projects/detail?id=${id}`, {
      headers: getAuthHeaders()
    })
    if (!res.ok) return undefined

    const cloud = await res.json()
    return {
      id: cloud.id,
      title: cloud.title,
      engineType: cloud.engine_type,
      thumbnail: cloud.thumbnail,
      createdAt: new Date(cloud.created_at),
      updatedAt: new Date(cloud.updated_at),
    }
  },

  /**
   * Get all projects, sorted by updatedAt descending
   */
  async getAll(): Promise<Project[]> {
    const res = await fetch('/api/projects', {
      headers: getAuthHeaders()
    })
    if (!res.ok) return []

    const cloudProjects = await res.json()
    return cloudProjects.map((p: {
      id: string;
      title: string;
      engine_type: string;
      thumbnail?: string;
      created_at: string;
      updated_at: string;
    }) => ({
      id: p.id,
      title: p.title,
      engineType: p.engine_type as EngineType,
      thumbnail: p.thumbnail || '',
      createdAt: new Date(p.created_at),
      updatedAt: new Date(p.updated_at),
    }))
  },

  /**
   * Update project
   */
  async update(
    id: string,
    data: Partial<Omit<Project, 'id' | 'createdAt'>>
  ): Promise<void> {
    const payload: Record<string, string> = {}
    if (data.title !== undefined) payload.title = data.title
    if (data.thumbnail !== undefined) payload.thumbnail = data.thumbnail

    if (Object.keys(payload).length === 0) return

    const res = await fetch(`/api/projects/detail?id=${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || '云端更新失败')
    }
  },

  /**
   * Delete project and its version history
   */
  async delete(id: string): Promise<void> {
    const res = await fetch(`/api/projects/detail?id=${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || '删除失败')
    }
  },

  /**
   * Search projects by title keyword
   */
  async search(keyword: string): Promise<Project[]> {
    const projects = await this.getAll()
    const lowerKeyword = keyword.toLowerCase()
    return projects
      .filter((project) => project.title.toLowerCase().includes(lowerKeyword))
  },
}
