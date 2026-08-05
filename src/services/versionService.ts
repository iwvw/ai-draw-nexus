import type { VersionHistory } from '@/types'
import { useAuthStore } from '@/stores/authStore'

interface CloudVersionSummary {
    id: string
    project_id: string
    change_summary: string
    timestamp: string
}

interface CloudVersionDetail extends CloudVersionSummary {
    content: string
}

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
 * Version History Repository
 * Data access layer for version history management.
 * Versions are stored in the workspace SQLite database, scoped to the
 * signed-in account. No browser-local persistence is used.
 */
export const VersionService = {
    /**
     * Create a new version
     */
    async create(data: {
        projectId: string
        content: string
        changeSummary: string
    }): Promise<VersionHistory> {
        const res = await fetch('/api/versions', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                project_id: data.projectId,
                content: data.content,
                change_summary: data.changeSummary
            })
        })
        if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.error || '云端版本创建失败')
        }
        const cloudVersion = await res.json() as { id: string; project_id: string; timestamp: string }

        return {
            id: cloudVersion.id,
            projectId: cloudVersion.project_id,
            content: data.content,
            changeSummary: data.changeSummary,
            timestamp: new Date(cloudVersion.timestamp),
        }
    },

    /**
     * Get all versions for a project, sorted by timestamp descending
     */
    async getByProjectId(projectId: string): Promise<VersionHistory[]> {
        const res = await fetch(`/api/versions?project_id=${projectId}`, {
            headers: getAuthHeaders()
        })
        if (!res.ok) return []

        const cloudVersions = await res.json() as CloudVersionSummary[]
        return cloudVersions.map((v) => ({
            id: v.id,
            projectId: v.project_id,
            content: '', // Content is usually heavy, don't list it
            changeSummary: v.change_summary,
            timestamp: new Date(v.timestamp)
        }))
    },

    /**
     * Get the latest version for a project
     */
    async getLatest(projectId: string): Promise<VersionHistory | undefined> {
        const versions = await this.getByProjectId(projectId)
        if (versions.length === 0) return undefined

        const latest = versions[0]
        if (!latest.content) {
            return this.getById(latest.id)
        }
        return latest
    },

    /**
     * Get version by ID
     */
    async getById(id: string): Promise<VersionHistory | undefined> {
        const res = await fetch(`/api/versions/detail?id=${id}`, {
            headers: getAuthHeaders()
        })
        if (!res.ok) return undefined

        const v = await res.json() as CloudVersionDetail
        return {
            id: v.id,
            projectId: v.project_id,
            content: v.content,
            changeSummary: v.change_summary,
            timestamp: new Date(v.timestamp)
        }
    },

    /**
     * Delete a specific version
     */
    async delete(id: string): Promise<void> {
        const res = await fetch(`/api/versions/detail?id=${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        })
        if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.error || '版本删除失败')
        }
    },

    /**
     * Delete all versions for a project
     */
    async deleteByProjectId(projectId: string): Promise<void> {
        const versions = await this.getByProjectId(projectId)
        await Promise.all(versions.map((v) => this.delete(v.id)))
    },

    /**
     * Update the latest version's content for a project
     */
    async updateLatest(projectId: string, content: string): Promise<void> {
        const latest = await this.getLatest(projectId)

        if (latest) {
            const now = new Date()
            const timeDiff = now.getTime() - latest.timestamp.getTime()
            const isRecent = timeDiff < 5 * 60 * 1000 // 5 minutes

            if (isRecent) {
                const res = await fetch(`/api/versions/detail?id=${latest.id}`, {
                    method: 'PUT',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ content })
                })
                if (res.ok) return
            }

            await this.create({
                projectId,
                content,
                changeSummary: '自动保存'
            })
            return
        }

        await this.create({
            projectId,
            content,
            changeSummary: '初始自动保存',
        })
    },
}
