import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { db } from '../db/sqlite'
import { hashPassword, type UserRole, type UserStatus } from '../auth-utils'
import { getRequestUser, requireAdmin, requireAuth } from '../middleware/auth'
import { writeAuditLog } from '../db/audit'

const admin = new Hono()

const AdminCreateUserSchema = z.object({
  username: z.string().min(3, '用户名至少需要 3 个字符').max(50),
  password: z.string().min(6, '密码至少需要 6 个字符').max(200),
  role: z.enum(['admin', 'member']).default('member'),
  status: z.enum(['active', 'suspended']).default('active'),
})

const AdminUpdateUserSchema = z
  .object({
    name: z.string().max(80).optional(),
    email: z.string().email().max(120).optional().nullable(),
    role: z.enum(['admin', 'member']).optional(),
    status: z.enum(['active', 'suspended']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: '没有可更新的字段' })

const UpdateSettingSchema = z.object({
  value: z.unknown(),
})

admin.use('*', requireAuth)
admin.use('*', requireAdmin)

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

function normalizeEmail(email?: string | null): string | null {
  const clean = email?.trim().toLowerCase()
  return clean ? clean : null
}

function listLimit(raw: string | undefined, fallback = 50): number {
  const value = raw ? Number(raw) : fallback
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), 200)
}

function stringifySetting(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function adminCount(): number {
  return (db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND status = 'active'").get() as {
    count: number
  }).count
}

admin.get('/stats', (c) => {
  const stats = {
    users: (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count,
    activeUsers: (db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'active'").get() as { count: number })
      .count,
    admins: (db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as { count: number }).count,
    projects: (db.prepare("SELECT COUNT(*) as count FROM projects WHERE status != 'deleted'").get() as { count: number })
      .count,
    versions: (db.prepare('SELECT COUNT(*) as count FROM versions').get() as { count: number }).count,
    aiRequestsToday: (
      db.prepare("SELECT COUNT(*) as count FROM ai_usage WHERE date(created_at) = date('now')").get() as {
        count: number
      }
    ).count,
  }

  return c.json(stats)
})

admin.get('/stats/ai-trend', (c) => {
  const days = Math.min(Math.max(Number(c.req.query('days')) || 7, 1), 90)
  const rows = db
    .prepare(
      `SELECT date(created_at) as day, status, COUNT(*) as count
       FROM ai_usage
       WHERE created_at >= datetime('now', ?)
       GROUP BY date(created_at), status
       ORDER BY day ASC`,
    )
    .all(`-${days} days`) as { day: string; status: string; count: number }[]

  return c.json(rows)
})

admin.get('/users', (c) => {
  const limit = listLimit(c.req.query('limit'), 100)
  const users = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.name, u.role, u.status, u.created_at, u.updated_at, u.last_login_at,
        COUNT(p.id) as project_count
       FROM users u
       LEFT JOIN projects p ON p.user_id = u.id AND p.status != 'deleted'
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT ?`,
    )
    .all(limit)

  return c.json(users)
})

admin.post('/users', async (c) => {
  try {
    const actor = getRequestUser(c)
    const parsed = AdminCreateUserSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

    const username = normalizeUsername(parsed.data.username)
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existingUser) return c.json({ error: '用户已存在' }, 409)

    const id = uuidv4()
    const passwordHash = await hashPassword(parsed.data.password)
    const name = username

    db.prepare(
      `INSERT INTO users (id, username, password_hash, name, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(id, username, passwordHash, name, parsed.data.role, parsed.data.status)

    writeAuditLog({
      actorUserId: actor.id,
      action: 'admin.user.create',
      targetType: 'user',
      targetId: id,
      metadata: { role: parsed.data.role, status: parsed.data.status },
    })

    return c.json({ id, username, name, role: parsed.data.role, status: parsed.data.status }, 201)
  } catch (err) {
    console.error('Admin create user error:', err)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

admin.patch('/users/:id', async (c) => {
  try {
    const actor = getRequestUser(c)
    const targetId = c.req.param('id')
    const parsed = AdminUpdateUserSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

    const target = db.prepare('SELECT id, role, status FROM users WHERE id = ?').get(targetId) as
      | { id: string; role: UserRole; status: UserStatus }
      | undefined
    if (!target) return c.json({ error: '用户不存在' }, 404)

    const wouldRemoveActiveAdmin =
      target.role === 'admin' &&
      target.status === 'active' &&
      (parsed.data.role === 'member' || parsed.data.status === 'suspended')
    if (wouldRemoveActiveAdmin && adminCount() <= 1) {
      return c.json({ error: '不能移除最后一个启用的管理员' }, 400)
    }

    if (targetId === actor.id && parsed.data.status === 'suspended') {
      return c.json({ error: '管理员不能停用自己的账号' }, 400)
    }

    const fields: string[] = []
    const params: unknown[] = []

    if (parsed.data.name !== undefined) {
      fields.push('name = ?')
      params.push(parsed.data.name.trim())
    }
    if (parsed.data.email !== undefined) {
      fields.push('email = ?')
      params.push(normalizeEmail(parsed.data.email))
    }
    if (parsed.data.role !== undefined) {
      fields.push('role = ?')
      params.push(parsed.data.role)
    }
    if (parsed.data.status !== undefined) {
      fields.push('status = ?')
      params.push(parsed.data.status)
    }

    fields.push('updated_at = CURRENT_TIMESTAMP')
    params.push(targetId)

    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params)

    writeAuditLog({
      actorUserId: actor.id,
      action: 'admin.user.update',
      targetType: 'user',
      targetId,
      metadata: { fields: Object.keys(parsed.data) },
    })

    return c.json({ success: true })
  } catch (err) {
    console.error('Admin update user error:', err)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

admin.get('/projects', (c) => {
  const limit = listLimit(c.req.query('limit'), 100)
  const projects = db
    .prepare(
      `SELECT p.id, p.title, p.engine_type, p.visibility, p.status, p.created_at, p.updated_at,
        u.id as owner_id, u.username as owner_username, u.email as owner_email,
        COUNT(v.id) as version_count
       FROM projects p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN versions v ON v.project_id = p.id
       WHERE p.status != 'deleted'
       GROUP BY p.id
       ORDER BY p.updated_at DESC
       LIMIT ?`,
    )
    .all(limit)

  return c.json(projects)
})

admin.get('/settings', (c) => {
  const settings = db
    .prepare(
      `SELECT s.key, s.value, s.updated_at, u.username as updated_by_username
       FROM settings s
       LEFT JOIN users u ON u.id = s.updated_by
       ORDER BY s.key ASC`,
    )
    .all()

  return c.json(settings)
})

admin.put('/settings/:key', async (c) => {
  try {
    const actor = getRequestUser(c)
    const key = c.req.param('key')
    const parsed = UpdateSettingSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: parsed.error.issues[0].message }, 400)

    const value = stringifySetting(parsed.data.value)
    db.prepare(
      `INSERT INTO settings (key, value, updated_by, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
    ).run(key, value, actor.id)

    writeAuditLog({
      actorUserId: actor.id,
      action: 'admin.setting.update',
      targetType: 'setting',
      targetId: key,
    })

    return c.json({ key, value })
  } catch (err) {
    console.error('Admin update setting error:', err)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

admin.get('/usage', (c) => {
  const limit = listLimit(c.req.query('limit'), 100)
  const usage = db
    .prepare(
      `SELECT a.id, a.provider, a.model_id, a.request_kind, a.prompt_tokens, a.completion_tokens,
        a.total_tokens, a.exempt, a.created_at, u.username
       FROM ai_usage a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .all(limit)

  return c.json(usage)
})

admin.get('/audit', (c) => {
  const limit = listLimit(c.req.query('limit'), 100)
  const audit = db
    .prepare(
      `SELECT l.id, l.action, l.target_type, l.target_id, l.metadata, l.created_at,
        u.username as actor_username
       FROM audit_logs l
       LEFT JOIN users u ON u.id = l.actor_user_id
       ORDER BY l.created_at DESC
       LIMIT ?`,
    )
    .all(limit)

  return c.json(audit)
})

export default admin
