import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
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
 * Data access layer for project management
 */
export const ProjectRepository = {
  /**
   * Create a new project
   */
  async create(data: {
    title: string
    engineType: EngineType
    thumbnail?: string
  }): Promise<Project> {
    const { isAuthenticated } = useAuthStore.getState()
    const now = new Date()
    const id = uuidv4()
    
    const project: Project = {
      id,
      title: data.title,
      engineType: data.engineType,
      thumbnail: data.thumbnail || '',
      createdAt: now,
      updatedAt: now,
    }

    if (isAuthenticated) {
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            id,
            title: data.title,
            engine_type: data.engineType,
            thumbnail: data.thumbnail
          })
        })
        if (!res.ok) throw new Error('Cloud save failed')
        
        // When logged in, we return the cloud project and DON'T save to local
        return project
      } catch (err) {
        console.error('Failed to save to cloud', err)
        throw err // Fail if cloud save fails and we are authenticated
      }
    }

    // Only save to local if NOT authenticated
    await db.projects.add(project)
    return project
  },

  /**
   * Get project by ID
   */
  async getById(id: string): Promise<Project | undefined> {
    const { isAuthenticated } = useAuthStore.getState()
    
    if (isAuthenticated) {
      try {
        const res = await fetch(`/api/projects/detail?id=${id}`, {
          headers: getAuthHeaders()
        })
        if (res.ok) {
          const cloud = await res.json()
          // Map DB snake_case to CamelCase
          const project: Project = {
            id: cloud.id,
            title: cloud.title,
            engineType: cloud.engine_type,
            thumbnail: cloud.thumbnail,
            createdAt: new Date(cloud.created_at),
            updatedAt: new Date(cloud.updated_at),
          }
          return project
        }
      } catch (err) {
        console.error('Cloud fetch failed', err)
      }
      return undefined // In cloud mode, if not in cloud, it doesn't exist
    }

    // Only use local if NOT authenticated
    return await db.projects.get(id)
  },

  /**
   * Get all projects, sorted by updatedAt descending
   */
  async getAll(): Promise<Project[]> {
    const { isAuthenticated } = useAuthStore.getState()
    
    if (isAuthenticated) {
      try {
        const res = await fetch('/api/projects', {
          headers: getAuthHeaders()
        })
        if (res.ok) {
          const cloudProjects = await res.json()
          return cloudProjects.map((p: any) => ({
            id: p.id,
            title: p.title,
            engineType: p.engine_type,
            thumbnail: p.thumbnail,
            createdAt: new Date(p.created_at),
            updatedAt: new Date(p.updated_at),
          }))
        }
      } catch (err) {
        console.error('Cloud list failed', err)
        return []
      }
    }

    return db.projects.orderBy('updatedAt').reverse().toArray()
  },

  /**
   * Update project
   */
  async update(
    id: string,
    data: Partial<Omit<Project, 'id' | 'createdAt'>>
  ): Promise<void> {
    const { isAuthenticated } = useAuthStore.getState()
    
    if (isAuthenticated) {
      try {
        await fetch(`/api/projects/detail?id=${id}`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify(data)
        })
        return // Skip local update
      } catch (err) {
        console.error('Cloud update failed', err)
        throw err
      }
    }

    await db.projects.update(id, {
      ...data,
      updatedAt: new Date(),
    })
  },

  /**
   * Delete project and its version history
   */
  async delete(id: string): Promise<void> {
    const { isAuthenticated } = useAuthStore.getState()
    
    if (isAuthenticated) {
      try {
        await fetch(`/api/projects/detail?id=${id}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        })
        return // Skip local delete
      } catch (err) {
        console.error('Cloud delete failed', err)
        throw err
      }
    }

    await db.transaction('rw', [db.projects, db.versionHistory], async () => {
      await db.versionHistory.where('projectId').equals(id).delete()
      await db.projects.delete(id)
    })
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

  /**
   * Sync all local projects to cloud
   */
  async syncAllLocalToCloud(): Promise<{ success: number; failed: number }> {
    const { isAuthenticated } = useAuthStore.getState()
    if (!isAuthenticated) return { success: 0, failed: 0 }

    const localProjects = await db.projects.toArray()
    let success = 0
    let failed = 0

    for (const project of localProjects) {
      try {
        // 1. Sync project metadata
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            id: project.id,
            title: project.title,
            engine_type: project.engineType,
            thumbnail: project.thumbnail
          })
        })

        if (res.ok || res.status === 409) { // 409 means already exists, still sync versions
          // 2. Sync all versions for this project
          const { VersionRepository } = await import('./versionRepository')
          const versions = await db.versionHistory.where('projectId').equals(project.id).toArray()
          
          for (const version of versions) {
             await fetch('/api/versions', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    project_id: project.id,
                    content: version.content,
                    change_summary: version.changeSummary || '同步自本地'
                })
             })
          }
          // 3. Delete local data after successful sync to keep local clean as requested
          await db.transaction('rw', [db.projects, db.versionHistory], async () => {
            await db.versionHistory.where('projectId').equals(project.id).delete()
            await db.projects.delete(project.id)
          })
          
          success++
        } else {
          failed++
        }
      } catch (err) {
        console.error(`Failed to sync project ${project.id}`, err)
        failed++
      }
    }

    return { success, failed }
  }
}
