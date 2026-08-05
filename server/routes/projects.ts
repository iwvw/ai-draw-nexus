import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { db } from '../db/sqlite'
import { requireAuth, getRequestUser } from '../middleware/auth'
import { writeAuditLog } from '../db/audit'

const projects = new Hono()

const CreateProjectSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1, '请输入项目名称').max(120),
  engine_type: z.enum(['drawio', 'excalidraw', 'mermaid']),
  thumbnail: z.string().optional(),
})

const UpdateProjectSchema = z
  .object({
    title: z.string().min(1, '请输入项目名称').max(120).optional(),
    thumbnail: z.string().optional(),
  })
  .refine((data) => data.title !== undefined || data.thumbnail !== undefined, {
    message: '没有可更新的字段',
  })

projects.use('*', requireAuth)

projects.get('/', (c) => {
  const user = getRequestUser(c)
  const results = db
    .prepare(
      `SELECT id, user_id, title, engine_type, thumbnail, visibility, status, created_at, updated_at
       FROM projects
       WHERE user_id = ? AND status != 'deleted'
       ORDER BY updated_at DESC`,
    )
    .all(user.id)

  return c.json(results, 200)
})

projects.post('/', async (c) => {
  try {
    const user = getRequestUser(c)
    const body = await c.req.json()
    const parsed = CreateProjectSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const { title, engine_type, thumbnail, id: customId } = parsed.data
    const projectId = customId || uuidv4()

    const existingProject = db.prepare('SELECT id, user_id FROM projects WHERE id = ?').get(projectId) as
      | { id: string; user_id: string }
      | undefined
    if (existingProject) {
      return c.json({ error: '项目已存在', id: projectId }, 409)
    }

    db.prepare(
      `INSERT INTO projects
        (id, user_id, title, engine_type, thumbnail, visibility, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'private', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(projectId, user.id, title, engine_type, thumbnail || '')

    writeAuditLog({
      actorUserId: user.id,
      action: 'project.create',
      targetType: 'project',
      targetId: projectId,
      metadata: { engineType: engine_type },
    })

    return c.json({ id: projectId, title, engine_type }, 201)
  } catch (err) {
    console.error('Create project error', err)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

projects.get('/detail', (c) => {
  const user = getRequestUser(c)
  const id = c.req.query('id')

  if (!id) return c.json({ error: '缺少项目 ID' }, 400)

  const project = db
    .prepare(
      `SELECT id, user_id, title, engine_type, thumbnail, visibility, status, created_at, updated_at
       FROM projects
       WHERE id = ? AND user_id = ? AND status != 'deleted'`,
    )
    .get(id, user.id)

  if (!project) return c.json({ error: '项目不存在' }, 404)

  return c.json(project, 200)
})

projects.put('/detail', async (c) => {
  const user = getRequestUser(c)
  const id = c.req.query('id')
  if (!id) return c.json({ error: '缺少项目 ID' }, 400)

  try {
    const body = await c.req.json()
    const parsed = UpdateProjectSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const fields: string[] = []
    const params: unknown[] = []

    if (parsed.data.title !== undefined) {
      fields.push('title = ?')
      params.push(parsed.data.title)
    }
    if (parsed.data.thumbnail !== undefined) {
      fields.push('thumbnail = ?')
      params.push(parsed.data.thumbnail)
    }

    fields.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id, user.id)

    const result = db
      .prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ? AND user_id = ? AND status != 'deleted'`)
      .run(...params)

    if (result.changes === 0) {
      return c.json({ error: '项目不存在或无权访问' }, 404)
    }

    writeAuditLog({
      actorUserId: user.id,
      action: 'project.update',
      targetType: 'project',
      targetId: id,
      metadata: { fields: Object.keys(parsed.data) },
    })

    return c.json({ success: true }, 200)
  } catch (err) {
    console.error('Update project error', err)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

projects.delete('/detail', (c) => {
  const user = getRequestUser(c)
  const id = c.req.query('id')
  if (!id) return c.json({ error: '缺少项目 ID' }, 400)

  try {
    const result = db
      .prepare(
        `UPDATE projects
         SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND status != 'deleted'`,
      )
      .run(id, user.id)

    if (result.changes === 0) {
      return c.json({ error: '项目不存在或无权访问' }, 404)
    }

    writeAuditLog({
      actorUserId: user.id,
      action: 'project.delete',
      targetType: 'project',
      targetId: id,
    })

    return c.json({ success: true }, 200)
  } catch (err) {
    console.error('Delete project error', err)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

export default projects
