import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { db } from '../db/sqlite'
import { generateDiagram, type EngineType } from '../ai/generate'

export interface Actor {
  id: string
  username: string
  role: string
}

function userOwnsProject(projectId: string, userId: string): boolean {
  const project = db
    .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ? AND status != 'deleted'")
    .get(projectId, userId)
  return Boolean(project)
}

interface LatestVersion {
  id: string
  project_id: string
  created_by: string | null
  change_summary: string
  content: string
  timestamp: string
}

function latestVersion(projectId: string): LatestVersion | undefined {
  return db
    .prepare(
      `SELECT id, project_id, created_by, change_summary, content, timestamp
       FROM versions
       WHERE project_id = ?
       ORDER BY timestamp DESC, rowid DESC
       LIMIT 1`,
    )
    .get(projectId) as LatestVersion | undefined
}

const ENGINES = ['drawio', 'excalidraw', 'mermaid'] as const

function inferEngine(content: string, filename?: string): (typeof ENGINES)[number] {
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

export function registerMcpTools(server: McpServer, getActor: () => Actor): void {
  server.registerTool(
    'list_projects',
    {
      title: '列出图表项目',
      description: '列出当前用户所有未删除的图表项目（含引擎类型、更新时间）。',
      inputSchema: z.object({}),
    },
    async () => {
      const actor = getActor()
      const results = db
        .prepare(
          `SELECT id, title, engine_type, visibility, status, created_at, updated_at
           FROM projects
           WHERE user_id = ? AND status != 'deleted'
           ORDER BY updated_at DESC`,
        )
        .all(actor.id)
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] }
    },
  )

  server.registerTool(
    'create_project',
    {
      title: '创建图表项目',
      description: '创建一个新的图表项目，返回项目 ID。引擎类型：drawio / excalidraw / mermaid。',
      inputSchema: z.object({
        title: z.string().describe('项目名称'),
        engine_type: z.enum(ENGINES).describe('绘图引擎'),
      }),
    },
    async ({ title, engine_type }) => {
      const actor = getActor()
      const projectId = crypto.randomUUID()
      db.prepare(
        `INSERT INTO projects
          (id, user_id, title, engine_type, thumbnail, visibility, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 'private', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).run(projectId, actor.id, title, engine_type)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ id: projectId, title, engine_type }, null, 2),
          },
        ],
      }
    },
  )

  server.registerTool(
    'get_project',
    {
      title: '获取项目详情',
      description: '获取项目元信息与当前最新内容（如果存在）。',
      inputSchema: z.object({
        id: z.string().describe('项目 ID'),
      }),
    },
    async ({ id }) => {
      const actor = getActor()
      const project = db
        .prepare(
          `SELECT id, title, engine_type, visibility, status, created_at, updated_at
           FROM projects
           WHERE id = ? AND user_id = ? AND status != 'deleted'`,
        )
        .get(id, actor.id)
      if (!project) {
        return { content: [{ type: 'text' as const, text: '项目不存在或无权访问' }] }
      }
      const version = latestVersion(id)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ...project, content: version?.content ?? null }, null, 2),
          },
        ],
      }
    },
  )

  server.registerTool(
    'get_project_content',
    {
      title: '读取图表内容',
      description: '读取项目当前最新的图表源码（版本内容）。',
      inputSchema: z.object({
        id: z.string().describe('项目 ID'),
      }),
    },
    async ({ id }) => {
      const actor = getActor()
      if (!userOwnsProject(id, actor.id)) {
        return { content: [{ type: 'text' as const, text: '项目不存在或无权访问' }] }
      }
      const version = latestVersion(id)
      if (!version) {
        return { content: [{ type: 'text' as const, text: '该项目尚无内容' }] }
      }
      return { content: [{ type: 'text' as const, text: version.content }] }
    },
  )

  server.registerTool(
    'update_project_content',
    {
      title: '更新图表内容',
      description: '将完整图表源码保存为新版本（内容将替换项目当前内容）。',
      inputSchema: z.object({
        id: z.string().describe('项目 ID'),
        content: z.string().describe('完整的图表源码'),
        change_summary: z.string().optional().describe('变更摘要（可选）'),
      }),
    },
    async ({ id, content, change_summary }) => {
      const actor = getActor()
      if (!userOwnsProject(id, actor.id)) {
        return { content: [{ type: 'text' as const, text: '项目不存在或无权访问' }] }
      }
      const versionId = crypto.randomUUID()
      db.transaction(() => {
        db.prepare(
          `INSERT INTO versions (id, project_id, created_by, content, change_summary, timestamp)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        ).run(versionId, id, actor.id, content, change_summary || '')
        db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
      })()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ version_id: versionId, project_id: id }) }],
      }
    },
  )

  server.registerTool(
    'list_versions',
    {
      title: '列出版本历史',
      description: '列出项目全部历史版本（不含内容，按时间倒序）。',
      inputSchema: z.object({
        id: z.string().describe('项目 ID'),
      }),
    },
    async ({ id }) => {
      const actor = getActor()
      if (!userOwnsProject(id, actor.id)) {
        return { content: [{ type: 'text' as const, text: '项目不存在或无权访问' }] }
      }
      const results = db
        .prepare(
          `SELECT id, project_id, created_by, change_summary, timestamp
           FROM versions
           WHERE project_id = ?
           ORDER BY timestamp DESC, rowid DESC`,
        )
        .all(id)
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] }
    },
  )

  server.registerTool(
    'get_version',
    {
      title: '读取版本内容',
      description: '按版本 ID 读取某一历史版本的内容。',
      inputSchema: z.object({
        id: z.string().describe('版本 ID'),
      }),
    },
    async ({ id }) => {
      const actor = getActor()
      const version = db
        .prepare(
          `SELECT v.id, v.project_id, v.created_by, v.change_summary, v.content, v.timestamp
           FROM versions v
           JOIN projects p ON v.project_id = p.id
           WHERE v.id = ? AND p.user_id = ? AND p.status != 'deleted'`,
        )
        .get(id, actor.id) as { content: string } | undefined
      if (!version) {
        return { content: [{ type: 'text' as const, text: '版本不存在或无权访问' }] }
      }
      return { content: [{ type: 'text' as const, text: version.content }] }
    },
  )

  server.registerTool(
    'generate_diagram',
    {
      title: 'AI 生成图表',
      description:
        '调用配置的 LLM 生成或修改图表源码。传入 project_id 时以该项目当前内容为上下文（修改场景）；否则生成新图。',
      inputSchema: z.object({
        prompt: z.string().describe('需求描述'),
        engine_type: z.enum(ENGINES).optional().describe('绘图引擎，默认 drawio'),
        project_id: z.string().optional().describe('项目 ID（可选，提供则基于当前内容修改）'),
      }),
    },
    async ({ prompt, engine_type, project_id }) => {
      const actor = getActor()
      const engineType: EngineType = (engine_type ?? 'drawio') as EngineType
      let currentContent: string | undefined
      if (project_id) {
        if (!userOwnsProject(project_id, actor.id)) {
          return { content: [{ type: 'text' as const, text: '项目不存在或无权访问' }] }
        }
        currentContent = latestVersion(project_id)?.content
      }

      try {
        const result = await generateDiagram({ prompt, engineType, currentContent }, actor.id)
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ engine_type: result.engineType, content: result.content }, null, 2),
            },
          ],
        }
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `生成失败：${error instanceof Error ? error.message : '未知错误'}` }],
      }
    }
  },
)

server.registerTool(
  'import_diagram',
  {
    title: '导入图表文件',
    description:
      '将一个图表文件（.mmd/.mermaid/.excalidraw/.drawio/.xml 文本内容）导入为新项目并保存为第一个版本。内容按扩展名/内容自动推断引擎，也可显式指定。',
    inputSchema: z.object({
      filename: z.string().describe('文件名（含扩展名），用于推断引擎'),
      content: z.string().describe('文件文本内容'),
      title: z.string().optional().describe('项目名称，默认取文件名（不含扩展名）'),
      engine_type: z.enum(ENGINES).optional().describe('显式指定引擎；不传则自动推断'),
    }),
  },
  async ({ filename, content, title, engine_type }) => {
    const actor = getActor()
    const engineType: (typeof ENGINES)[number] = engine_type ?? inferEngine(content, filename)
    const projectTitle = title ?? filename.replace(/\.[^/.]+$/, '')
    const projectId = crypto.randomUUID()
    const versionId = crypto.randomUUID()

    db.transaction(() => {
      db.prepare(
        `INSERT INTO projects
          (id, user_id, title, engine_type, thumbnail, visibility, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 'private', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).run(projectId, actor.id, projectTitle, engineType)
      db.prepare(
        `INSERT INTO versions (id, project_id, created_by, content, change_summary, timestamp)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      ).run(versionId, projectId, actor.id, content, '文件导入')
    })()

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            { project_id: projectId, title: projectTitle, engine_type: engineType, version_id: versionId, bytes: content.length },
            null,
            2,
          ),
        },
      ],
    }
  },
)
}
