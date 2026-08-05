import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { db } from '../db/sqlite'
import { requireAuth, getRequestUser } from '../middleware/auth'
import { writeAuditLog } from '../db/audit'
import { generateDiagram, type EngineType } from '../ai/generate'

const api = new Hono()

const ENGINE_VALUES = ['drawio', 'excalidraw', 'mermaid'] as const

const CreateProjectSchema = z.object({
  title: z.string().min(1, '请输入项目名称').max(120),
  engine_type: z.enum(ENGINE_VALUES),
})

const UpdateProjectSchema = z.object({
  title: z.string().min(1, '请输入项目名称').max(120),
})

const PutContentSchema = z.object({
  content: z.string().min(1, '内容不能为空'),
  change_summary: z.string().max(500).optional(),
})

const GenerateSchema = z.object({
  prompt: z.string().min(1, '请输入提示词').max(8000),
  engine_type: z.enum(ENGINE_VALUES).optional(),
  current_content: z.string().optional(),
})

api.use('*', requireAuth)

function projectOwnerOrNull(projectId: string, userId: string) {
  return db
    .prepare(
      `SELECT id, user_id, title, engine_type, thumbnail, visibility, status, created_at, updated_at
       FROM projects
       WHERE id = ? AND user_id = ? AND status != 'deleted'`,
    )
    .get(projectId, userId) as
    | { id: string; user_id: string; title: string; engine_type: EngineType; created_at: string; updated_at: string }
    | undefined
}

function latestVersion(projectId: string) {
  return db
    .prepare(
      `SELECT id, project_id, created_by, change_summary, content, timestamp
       FROM versions
       WHERE project_id = ?
       ORDER BY timestamp DESC, rowid DESC
       LIMIT 1`,
    )
    .get(projectId) as
    | { id: string; project_id: string; created_by: string | null; change_summary: string; content: string; timestamp: string }
    | undefined
}

// GET /api/v1/projects
api.get('/projects', (c) => {
  const user = getRequestUser(c)
  const results = db
    .prepare(
      `SELECT id, title, engine_type, thumbnail, visibility, status, created_at, updated_at
       FROM projects
       WHERE user_id = ? AND status != 'deleted'
       ORDER BY updated_at DESC`,
    )
    .all(user.id)
  return c.json({ data: results })
})

// POST /api/v1/projects
api.post('/projects', async (c) => {
  const user = getRequestUser(c)
  const body = await c.req.json().catch(() => null)
  const parsed = CreateProjectSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

  const projectId = uuidv4()
  db.prepare(
    `INSERT INTO projects
      (id, user_id, title, engine_type, thumbnail, visibility, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', 'private', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  ).run(projectId, user.id, parsed.data.title, parsed.data.engine_type)

  writeAuditLog({
    actorUserId: user.id,
    action: 'project.create',
    targetType: 'project',
    targetId: projectId,
    metadata: { source: 'api.v1', engineType: parsed.data.engine_type },
  })

  return c.json(
    {
      data: {
        id: projectId,
        title: parsed.data.title,
        engine_type: parsed.data.engine_type,
        content: null,
        version_id: null,
      },
    },
    201,
  )
})

// GET /api/v1/projects/:id
api.get('/projects/:id', (c) => {
  const user = getRequestUser(c)
  const project = projectOwnerOrNull(c.req.param('id'), user.id)
  if (!project) return c.json({ error: '项目不存在或无权访问' }, 404)

  const version = latestVersion(project.id)
  return c.json({
    data: {
      ...project,
      content: version?.content ?? null,
      version_id: version?.id ?? null,
      version_updated_at: version?.timestamp ?? null,
    },
  })
})

// PATCH /api/v1/projects/:id
api.patch('/projects/:id', async (c) => {
  const user = getRequestUser(c)
  const project = projectOwnerOrNull(c.req.param('id'), user.id)
  if (!project) return c.json({ error: '项目不存在或无权访问' }, 404)

  const body = await c.req.json().catch(() => null)
  const parsed = UpdateProjectSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

  db.prepare("UPDATE projects SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    parsed.data.title,
    project.id,
  )
  return c.json({ data: { id: project.id, title: parsed.data.title } })
})

// DELETE /api/v1/projects/:id
api.delete('/projects/:id', (c) => {
  const user = getRequestUser(c)
  const project = projectOwnerOrNull(c.req.param('id'), user.id)
  if (!project) return c.json({ error: '项目不存在或无权访问' }, 404)

  db.prepare("UPDATE projects SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(project.id)

  writeAuditLog({
    actorUserId: user.id,
    action: 'project.delete',
    targetType: 'project',
    targetId: project.id,
    metadata: { source: 'api.v1' },
  })

  return c.json({ data: { success: true } })
})

// GET /api/v1/projects/:id/content
api.get('/projects/:id/content', (c) => {
  const user = getRequestUser(c)
  const project = projectOwnerOrNull(c.req.param('id'), user.id)
  if (!project) return c.json({ error: '项目不存在或无权访问' }, 404)

  const version = latestVersion(project.id)
  return c.json({
    data: {
      project_id: project.id,
      engine_type: project.engine_type,
      content: version?.content ?? '',
      version_id: version?.id ?? null,
      version_updated_at: version?.timestamp ?? null,
    },
  })
})

// PUT /api/v1/projects/:id/content
api.put('/projects/:id/content', async (c) => {
  const user = getRequestUser(c)
  const project = projectOwnerOrNull(c.req.param('id'), user.id)
  if (!project) return c.json({ error: '项目不存在或无权访问' }, 404)

  const body = await c.req.json().catch(() => null)
  const parsed = PutContentSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

  const versionId = uuidv4()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO versions (id, project_id, created_by, content, change_summary, timestamp)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ).run(versionId, project.id, user.id, parsed.data.content, parsed.data.change_summary || '')
    db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(project.id)
  })()

  return c.json({ data: { version_id: versionId, project_id: project.id } }, 201)
})

// GET /api/v1/projects/:id/versions
api.get('/projects/:id/versions', (c) => {
  const user = getRequestUser(c)
  const project = projectOwnerOrNull(c.req.param('id'), user.id)
  if (!project) return c.json({ error: '项目不存在或无权访问' }, 404)

  const results = db
    .prepare(
      `SELECT id, project_id, created_by, change_summary, timestamp
       FROM versions
       WHERE project_id = ?
       ORDER BY timestamp DESC, rowid DESC`,
    )
    .all(project.id)

  return c.json({ data: results })
})

// GET /api/v1/versions/:id
api.get('/versions/:id', (c) => {
  const user = getRequestUser(c)
  const version = db
    .prepare(
      `SELECT v.id, v.project_id, v.created_by, v.change_summary, v.content, v.timestamp
       FROM versions v
       JOIN projects p ON v.project_id = p.id
       WHERE v.id = ? AND p.user_id = ? AND p.status != 'deleted'`,
    )
    .get(c.req.param('id'), user.id)

  if (!version) return c.json({ error: '版本不存在或无权访问' }, 404)
  return c.json({ data: version })
})

// POST /api/v1/generate
api.post('/generate', async (c) => {
  const user = getRequestUser(c)
  const body = await c.req.json().catch(() => null)
  const parsed = GenerateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

  const engineType: EngineType = parsed.data.engine_type ?? 'drawio'
  try {
    const result = await generateDiagram(
      {
        prompt: parsed.data.prompt,
        engineType,
        currentContent: parsed.data.current_content,
      },
      user.id,
    )
    return c.json({ data: result })
  } catch (error) {
    console.error('Generate error:', error)
    return c.json({ error: error instanceof Error ? error.message : '生成失败' }, 500)
  }
})

// GET /api/v1/engines
api.get('/engines', (c) => {
  return c.json({ data: ENGINE_VALUES.map((value) => ({ value, label: value })) })
})

export default api
