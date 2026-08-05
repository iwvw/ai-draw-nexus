import type { Context, Next } from 'hono'
import { db } from '../db/sqlite'
import { verifyToken, type AuthPayload, type UserRole, type UserStatus } from '../auth-utils'
import { readAuthCookie } from '../cookie'
import { isApiTokenValid } from '../db/api-tokens'

export interface RequestUser {
  id: string
  username: string
  email: string | null
  name: string
  role: UserRole
  status: UserStatus
}

async function verifiedPayloadFromToken(token: string): Promise<AuthPayload | null> {
  const verified = await verifyToken(token)
  if (!verified) return null
  // API tokens carry a jti and must not be revoked/expired at the database level.
  if (verified.jti && !isApiTokenValid(verified.jti)) return null
  return verified
}

export async function getAuthPayloadFromRequest(c: Context) {
  const cookieToken = readAuthCookie(c)
  if (cookieToken) {
    const verified = await verifiedPayloadFromToken(cookieToken)
    if (verified) return verified
  }
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const verified = await verifiedPayloadFromToken(authHeader.slice('Bearer '.length))
    if (verified) return verified
  }
  return null
}

export async function requireAuth(c: Context, next: Next) {
  const payload = await getAuthPayloadFromRequest(c)
  if (!payload) return c.json({ error: '请先登录' }, 401)

  const user = db
    .prepare('SELECT id, username, email, name, role, status FROM users WHERE id = ?')
    .get(payload.userId) as RequestUser | undefined

  if (!user) return c.json({ error: '请先登录' }, 401)
  if (user.status !== 'active') return c.json({ error: '账号已停用' }, 403)

  c.set('user', user)
  await next()
}

/**
 * When the workspace is not public, every API request must come from a
 * signed-in user. Applied at the app level, before any business route.
 */
export async function requireLoginIfLocked(c: Context, next: Next) {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'security.allow_public_access'").get() as
    | { value: string }
    | undefined

  if (setting?.value !== 'false') {
    await next()
    return
  }

  const payload = await getAuthPayloadFromRequest(c)
  if (!payload) return c.json({ error: '请先登录' }, 401)

  const user = db
    .prepare('SELECT id, username, email, name, role, status FROM users WHERE id = ?')
    .get(payload.userId) as RequestUser | undefined

  if (!user || user.status !== 'active') return c.json({ error: '请先登录' }, 401)

  c.set('user', user)
  await next()
}

export async function requireAdmin(c: Context, next: Next) {
  const user = c.get('user') as RequestUser | undefined
  if (!user) return c.json({ error: '请先登录' }, 401)
  if (user.role !== 'admin') return c.json({ error: '需要管理员权限' }, 403)

  await next()
}

export function getRequestUser(c: Context): RequestUser {
  return c.get('user') as RequestUser
}
