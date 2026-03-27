import { v4 as uuidv4 } from 'uuid'
import { db } from '@/lib/db'
import type { VersionHistory } from '@/types'

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
    const version: VersionHistory = {
      id: uuidv4(),
      projectId: data.projectId,
      content: data.content,
      changeSummary: data.changeSummary,
      timestamp: new Date(),
    }

    await db.versionHistory.add(version)
    return version
  },

  /**
   * Get all versions for a project, sorted by timestamp descending
   */
  async getByProjectId(projectId: string): Promise<VersionHistory[]> {
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
    const versions = await db.versionHistory
      .where('projectId')
      .equals(projectId)
      .reverse()
      .sortBy('timestamp')
    return versions[0]
  },

  /**
   * Get version by ID
   */
  async getById(id: string): Promise<VersionHistory | undefined> {
    return db.versionHistory.get(id)
  },

  /**
   * Delete a specific version
   */
  async delete(id: string): Promise<void> {
    await db.versionHistory.delete(id)
  },

  /**
   * Delete all versions for a project
   */
  async deleteByProjectId(projectId: string): Promise<void> {
    await db.versionHistory.where('projectId').equals(projectId).delete()
  },

  /**
   * Update the latest version's content for a project
   * Used when user manually edits the diagram (e.g., in Excalidraw)
   */
  async updateLatest(projectId: string, content: string): Promise<void> {
    const latest = await this.getLatest(projectId)
    if (latest) {
      await db.versionHistory.update(latest.id, { content })
    } else {
      // If no version exists (new project), create the first one
      await this.create({
        projectId,
        content,
        changeSummary: '自动保存',
      })
    }
  },
}
