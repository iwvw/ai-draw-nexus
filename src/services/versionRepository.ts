import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import type { VersionHistory } from '@/types'
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
 * Version History Repository
 * Data access layer for version history management
 */
export const VersionRepository = {
    /**
     * Create a new version
     */
    async create(data: {
        projectId: string
        content: string
        changeSummary: string
    }): Promise<VersionHistory> {
        const { isAuthenticated } = useAuthStore.getState()
        const id = uuidv4()
        const version: VersionHistory = {
            id,
            projectId: data.projectId,
            content: data.content,
            changeSummary: data.changeSummary,
            timestamp: new Date(),
        }

        if (isAuthenticated) {
            try {
                const res = await fetch('/api/versions', {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        project_id: data.projectId,
                        content: data.content,
                        change_summary: data.changeSummary
                    })
                })
                if (!res.ok) throw new Error('Cloud version creation failed')
                
                // Return cloud version and DON'T save to local
                return version
            } catch (err) {
                console.error('Failed to save version to cloud', err)
                throw err
            }
        }

        // Only save to local if NOT authenticated
        await db.versionHistory.add(version)
        return version
    },

    /**
     * Get all versions for a project, sorted by timestamp descending
     */
    async getByProjectId(projectId: string): Promise<VersionHistory[]> {
        const { isAuthenticated } = useAuthStore.getState()

        if (isAuthenticated) {
            try {
                const res = await fetch(`/api/versions?project_id=${projectId}`, {
                    headers: getAuthHeaders()
                })
                if (res.ok) {
                    const cloudVersions = await res.json()
                    return cloudVersions.map((v: any) => ({
                        id: v.id,
                        projectId: v.project_id,
                        content: '', // Content is usually heavy, don't list it
                        changeSummary: v.change_summary,
                        timestamp: new Date(v.timestamp)
                    }))
                }
            } catch (err) {
                console.error('Cloud version list failed', err)
                return []
            }
            return []
        }

        // Only use local if NOT authenticated
        return db.versionHistory
            .where('projectId')
            .equals(projectId)
            .reverse()
            .sortBy('timestamp')
    },

    /**
     * Get the latest version for a project
     */
    async getLatest(projectId: string): Promise<VersionHistory | undefined> {
        const versions = await this.getByProjectId(projectId)
        if (versions.length === 0) return undefined

        // If it's a cloud version and we don't have content locally, fetch detail
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
        const { isAuthenticated } = useAuthStore.getState()
        
        if (isAuthenticated) {
            try {
                const res = await fetch(`/api/versions/detail?id=${id}`, {
                    headers: getAuthHeaders()
                })
                if (res.ok) {
                    const v = await res.json()
                    const version: VersionHistory = {
                        id: v.id,
                        projectId: v.project_id,
                        content: v.content,
                        changeSummary: v.change_summary,
                        timestamp: new Date(v.timestamp)
                    }
                    return version
                }
            } catch (err) {
                console.error('Cloud version detail fetch failed', err)
            }
            return undefined
        }

        // Only use local if NOT authenticated
        return await db.versionHistory.get(id)
    },

    /**
     * Delete a specific version
     */
    async delete(id: string): Promise<void> {
        const { isAuthenticated } = useAuthStore.getState()
        if (!isAuthenticated) {
            await db.versionHistory.delete(id)
        }
    },

    /**
     * Delete all versions for a project
     */
    async deleteByProjectId(projectId: string): Promise<void> {
        const { isAuthenticated } = useAuthStore.getState()
        if (!isAuthenticated) {
            await db.versionHistory.where('projectId').equals(projectId).delete()
        }
    },

    /**
     * Update the latest version's content for a project
     */
    async updateLatest(projectId: string, content: string): Promise<void> {
        const latest = await this.getLatest(projectId)
        const { isAuthenticated } = useAuthStore.getState()

        if (latest) {
            const now = new Date()
            const timeDiff = now.getTime() - latest.timestamp.getTime()
            const isRecent = timeDiff < 5 * 60 * 1000 // 5 minutes

            if (isAuthenticated) {
                try {
                    // Only update existing version if it's "recent" (5 mins), same as local logic
                    if (isRecent) {
                        const res = await fetch(`/api/versions/detail?id=${latest.id}`, {
                            method: 'PUT',
                            headers: getAuthHeaders(),
                            body: JSON.stringify({ content })
                        })
                        
                        if (res.ok) return // Success, skip local update
                    }

                    // If update fails (e.g. version too old or logic mismatch), create new
                    await this.create({
                        projectId,
                        content,
                        changeSummary: '自动保存 (新)'
                    })
                    return // Skip local update
                } catch (err) {
                    console.error('Failed to update cloud version', err)
                    throw err
                }
            }
            // Update local (Only if not authenticated)
            await db.versionHistory.update(latest.id, { content, timestamp: now })
        } else {
            await this.create({
                projectId,
                content,
                changeSummary: '初始自动保存',
            })
        }
    },
}
