import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/sqlite'
import {
  generateToken,
  hashPassword,
  isLegacyPasswordHash,
  LoginSchema,
  RegisterSchema,
  verifyPassword,
  type UserRole,
} from '../auth-utils'
import { requireAuth, getRequestUser } from '../middleware/auth'
import { writeAuditLog } from '../db/audit'
import { clearAuthCookie, setAuthCookie } from '../cookie'
import { storeApiToken, listApiTokens, revokeApiToken } from '../db/api-tokens'

const auth = new Hono()

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

function registrationAllowed(): boolean {
  if (process.env.DISABLE_REGISTRATION === 'true') return false

  const setting = db.prepare("SELECT value FROM settings WHERE key = 'security.allow_registration'").get() as
    | { value: string }
    | undefined
  return setting?.value !== 'false'
}

auth.post('/register', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = RegisterSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count
    if (userCount > 0 && !registrationAllowed()) {
      return c.json({ error: '当前工作区已关闭注册' }, 403)
    }

    const username = normalizeUsername(parsed.data.username)
    const name = username

    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existingUser) {
      return c.json({ error: '用户名已存在' }, 409)
    }

    const userId = uuidv4()
    const passwordHash = await hashPassword(parsed.data.password)
    const role: UserRole = userCount === 0 ? 'admin' : 'member'

    db.prepare(
      `INSERT INTO users (id, username, password_hash, name, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(userId, username, passwordHash, name, role)

    writeAuditLog({
      actorUserId: userId,
      action: 'auth.register',
      targetType: 'user',
      targetId: userId,
      metadata: { role },
    })

    const token = await generateToken({ userId, username, name, role })

    return c.json(
      {
        user: { id: userId, username, name, role },
        token,
      },
      201,
      { 'Set-Cookie': setAuthCookie(token) },
    )
  } catch (error) {
    console.error('Registration error:', error)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

auth.post('/login', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = LoginSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const login = normalizeUsername(parsed.data.username)
    const user = db
      .prepare(
        `SELECT id, username, email, name, password_hash, role, status
         FROM users
         WHERE username = ? OR email = ?`,
      )
      .get(login, login) as
      | {
          id: string
          username: string
          email: string | null
          name: string
          password_hash: string
          role: UserRole
          status: string
        }
      | undefined

    if (!user) {
      return c.json({ error: '用户名或密码不正确' }, 401)
    }

    if (user.status !== 'active') {
      return c.json({ error: '账号已停用' }, 403)
    }

    const validPassword = await verifyPassword(parsed.data.password, user.password_hash)
    if (!validPassword) {
      return c.json({ error: '用户名或密码不正确' }, 401)
    }

    if (isLegacyPasswordHash(user.password_hash)) {
      const migratedHash = await hashPassword(parsed.data.password)
      db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        migratedHash,
        user.id,
      )
    }

    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id)
    writeAuditLog({
      actorUserId: user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
    })

    const token = await generateToken({
      userId: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    })

    return c.json(
      {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        token,
      },
      200,
      { 'Set-Cookie': setAuthCookie(token) },
    )
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

auth.post('/logout', (c) => {
  return c.json({ success: true }, 200, { 'Set-Cookie': clearAuthCookie() })
})

auth.get('/status', (c) => {
  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count
  const allowPublic = db.prepare("SELECT value FROM settings WHERE key = 'security.allow_public_access'").get() as
    | { value: string }
    | undefined

  return c.json({
    initialized: userCount > 0,
    allowPublic: allowPublic?.value !== 'false',
    allowRegistration: registrationAllowed(),
  })
})

auth.get('/me', requireAuth, (c) => {
  const user = getRequestUser(c)

  return c.json(
    {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
      },
    },
    200,
  )
})

// Generate an API access token with an optional validity period.
// Default (no expires_in_days or 0) issues a permanent token.
// Tokens are persisted (hashed) and can be revoked, enabling rotation.
// The current user must be authenticated.
auth.post('/api-token', requireAuth, async (c) => {
  try {
    const user = getRequestUser(c)
    const body = await c.req.json().catch(() => null)
    const days = body && typeof body === 'object' && 'expires_in_days' in body ? Number(body.expires_in_days) : 0
    const normalizedDays = Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), 3650) : 0
    const name = body && typeof body === 'object' && 'name' in body && String(body.name) ? String(body.name) : ''

    const jti = randomUUID()
    const expiresAt = normalizedDays > 0 ? new Date(Date.now() + normalizedDays * 24 * 60 * 60 * 1000) : undefined
    const token = await generateToken(
      {
        userId: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        jti,
      },
      normalizedDays > 0 ? { expiresInSeconds: normalizedDays * 24 * 60 * 60 } : undefined,
    )
    const tokenId = storeApiToken({ userId: user.id, name, jti, token, expiresAt })

    writeAuditLog({
      actorUserId: user.id,
      action: 'auth.api_token',
      targetType: 'user',
      targetId: user.id,
      metadata: { tokenId, expiresInDays: normalizedDays },
    })

    return c.json({
      token,
      token_id: tokenId,
      expires_in_days: normalizedDays,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
    })
  } catch (error) {
    console.error('API token error:', error)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

// List the current user's active API tokens (for rotation management).
auth.get('/api-tokens', requireAuth, (c) => {
  const user = getRequestUser(c)
  const tokens = listApiTokens(user.id)
  return c.json({ data: tokens })
})

// Revoke an API token by id (rotation / security).
auth.delete('/api-tokens/:id', requireAuth, (c) => {
  const user = getRequestUser(c)
  const tokenId = c.req.param('id') as string
  const ok = revokeApiToken(tokenId, user.id)
  if (!ok) return c.json({ error: '令牌不存在或已撤销' }, 404)
  writeAuditLog({
    actorUserId: user.id,
    action: 'auth.api_token_revoke',
    targetType: 'user',
    targetId: user.id,
    metadata: { tokenId },
  })
  return c.json({ success: true })
})

export default auth
