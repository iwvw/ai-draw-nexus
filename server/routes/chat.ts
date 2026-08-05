import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { db } from '../db/sqlite'
import { requireAuth, getRequestUser } from '../middleware/auth'
import { writeAuditLog } from '../db/audit'

const chat = new Hono()

const CreateMessageSchema = z.object({
  project_id: z.string().uuid('项目 ID 无效'),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(200_000, '消息内容过长'),
  attachments: z.array(z.unknown()).optional(),
  status: z.enum(['pending', 'streaming', 'complete', 'error']).optional(),
  id: z.string().uuid().optional(),
})

const UpdateMessageSchema = z
  .object({
    content: z.string().max(200_000, '消息内容过长').optional(),
    status: z.enum(['pending', 'streaming', 'complete', 'error']).optional(),
    attachments: z.array(z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: '没有可更新的字段' })

chat.use('*', requireAuth)

function userOwnsProject(projectId: string, userId: string): boolean {
  const project = db
    .prepare("SELECT id FROM projects WHERE id = ? AND user_id = ? AND status != 'deleted'")
    .get(projectId, userId)
  return Boolean(project)
}

chat.get('/', (c) => {
  const user = getRequestUser(c)
  const projectId = c.req.query('project_id')

  if (!projectId) return c.json({ error: '缺少项目 ID' }, 400)
  if (!userOwnsProject(projectId, user.id)) {
    return c.json({ error: '项目不存在或无权访问' }, 404)
  }

  const results = db
    .prepare(
      `SELECT id, project_id, user_id, role, content, attachments, status, created_at, updated_at
       FROM chat_messages
       WHERE project_id = ?
       ORDER BY created_at ASC`,
    )
    .all(projectId)

  return c.json(results, 200)
})

chat.post('/', async (c) => {
  try {
    const user = getRequestUser(c)
    const body = await c.req.json()
    const parsed = CreateMessageSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const { project_id, role, content, attachments, status, id } = parsed.data
    if (!userOwnsProject(project_id, user.id)) {
      return c.json({ error: '项目不存在或无权访问' }, 404)
    }

    const messageId = id || uuidv4()
    const attachmentsJson = JSON.stringify(attachments || [])

    db.transaction(() => {
      db.prepare(
        `INSERT INTO chat_messages
          (id, project_id, user_id, role, content, attachments, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).run(messageId, project_id, user.id, role, content, attachmentsJson, status || 'complete')
      db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(project_id)
    })()

    return c.json({ id: messageId, project_id }, 201)
  } catch (err) {
    console.error('Create chat message error', err)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

chat.put('/:id', async (c) => {
  try {
    const user = getRequestUser(c)
    const id = c.req.param('id')
    const body = await c.req.json()
    const parsed = UpdateMessageSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const message = db
      .prepare(
        `SELECT m.id, m.project_id
         FROM chat_messages m
         JOIN projects p ON m.project_id = p.id
         WHERE m.id = ? AND p.user_id = ? AND p.status != 'deleted'`,
      )
      .get(id, user.id) as { id: string; project_id: string } | undefined

    if (!message) return c.json({ error: '消息不存在或无权访问' }, 404)

    const fields: string[] = []
    const params: unknown[] = []

    if (parsed.data.content !== undefined) {
      fields.push('content = ?')
      params.push(parsed.data.content)
    }
    if (parsed.data.status !== undefined) {
      fields.push('status = ?')
      params.push(parsed.data.status)
    }
    if (parsed.data.attachments !== undefined) {
      fields.push('attachments = ?')
      params.push(JSON.stringify(parsed.data.attachments))
    }

    fields.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id)

    db.transaction(() => {
      db.prepare(`UPDATE chat_messages SET ${fields.join(', ')} WHERE id = ?`).run(...params)
      db.prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(message.project_id)
    })()

    return c.json({ success: true }, 200)
  } catch (err) {
    console.error('Update chat message error', err)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

chat.delete('/', (c) => {
  const user = getRequestUser(c)
  const projectId = c.req.query('project_id')

  if (!projectId) return c.json({ error: '缺少项目 ID' }, 400)
  if (!userOwnsProject(projectId, user.id)) {
    return c.json({ error: '项目不存在或无权访问' }, 404)
  }

  const result = db
    .prepare('DELETE FROM chat_messages WHERE project_id = ? AND user_id = ?')
    .run(projectId, user.id)

  writeAuditLog({
    actorUserId: user.id,
    action: 'chat.clear',
    targetType: 'project',
    targetId: projectId,
    metadata: { deleted: result.changes },
  })

  return c.json({ success: true, deleted: result.changes }, 200)
})

export default chat
