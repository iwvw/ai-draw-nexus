import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { db } from '../db/sqlite'
import { requireAuth, getRequestUser } from '../middleware/auth'

const versions = new Hono()

const CreateVersionSchema = z.object({
  project_id: z.string().uuid('项目 ID 无效'),
  content: z.string(),
  change_summary: z.string().optional(),
})

const UpdateVersionSchema = z.object({
  content: z.string().min(1, '版本内容不能为空'),
})

versions.use('*', requireAuth)

function userOwnsProject(projectId: string, userId: string): boolean {
  const project = db
    .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ? AND status != 'deleted'")
    .get(projectId, userId)
  return Boolean(project)
}

versions.get('/', (c) => {
  const user = getRequestUser(c)
  const projectId = c.req.query('project_id')

  if (!projectId) return c.json({ error: '缺少项目 ID' }, 400)
  if (!userOwnsProject(projectId, user.id)) {
    return c.json({ error: '项目不存在或无权访问' }, 404)
  }

  const results = db
    .prepare(
      `SELECT id, project_id, created_by, change_summary, timestamp
       FROM versions
       WHERE project_id = ?
       ORDER BY timestamp DESC`,
    )
    .all(projectId)

  return c.json(results, 200)
})

versions.post('/', async (c) => {
  try {
    const user = getRequestUser(c)
    const body = await c.req.json()
    const parsed = CreateVersionSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const { project_id, content, change_summary } = parsed.data
    if (!userOwnsProject(project_id, user.id)) {
      return c.json({ error: '项目不存在或无权访问' }, 404)
    }

    const versionId = uuidv4()

    db.transaction(() => {
      db.prepare(
        `INSERT INTO versions (id, project_id, created_by, content, change_summary, timestamp)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      ).run(versionId, project_id, user.id, content, change_summary || '')

      db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(project_id)
    })()

    return c.json({ id: versionId, project_id, timestamp: new Date().toISOString() }, 201)
  } catch (err) {
    console.error('Create version error', err)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

versions.get('/detail', (c) => {
  const user = getRequestUser(c)
  const id = c.req.query('id')

  if (!id) return c.json({ error: '缺少版本 ID' }, 400)

  const version = db
    .prepare(
      `SELECT v.*
       FROM versions v
       JOIN projects p ON v.project_id = p.id
       WHERE v.id = ? AND p.user_id = ? AND p.status != 'deleted'`,
    )
    .get(id, user.id)

  if (!version) return c.json({ error: '版本不存在或无权访问' }, 404)

  return c.json(version, 200)
})

versions.put('/detail', async (c) => {
  try {
    const user = getRequestUser(c)
    const id = c.req.query('id')
    if (!id) return c.json({ error: '缺少版本 ID' }, 400)

    const body = await c.req.json()
    const parsed = UpdateVersionSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const version = db
      .prepare(
        `SELECT v.id, v.project_id
         FROM versions v
         JOIN projects p ON v.project_id = p.id
         WHERE v.id = ? AND p.user_id = ? AND p.status != 'deleted'`,
      )
      .get(id, user.id) as { id: string; project_id: string } | undefined

    if (!version) return c.json({ error: '版本不存在或无权访问' }, 404)

    db.transaction(() => {
      db.prepare('UPDATE versions SET content = ?, timestamp = CURRENT_TIMESTAMP WHERE id = ?').run(
        parsed.data.content,
        id,
      )
      db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(version.project_id)
    })()

    return c.json({ success: true }, 200)
  } catch (err) {
    console.error('Update version error', err)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

versions.delete('/detail', (c) => {
  const user = getRequestUser(c)
  const id = c.req.query('id')
  if (!id) return c.json({ error: '缺少版本 ID' }, 400)

  const result = db
    .prepare(
      `DELETE FROM versions
       WHERE id = ?
         AND project_id IN (SELECT id FROM projects WHERE user_id = ? AND status != 'deleted')`,
    )
    .run(id, user.id)

  if (result.changes === 0) return c.json({ error: '版本不存在或无权访问' }, 404)

  return c.json({ success: true }, 200)
})

export default versions
