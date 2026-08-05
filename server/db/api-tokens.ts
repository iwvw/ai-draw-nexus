import { createHash } from 'crypto'
import { randomUUID } from 'crypto'
import { db } from './sqlite'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface ApiTokenRecord {
  id: string
  user_id: string
  name: string
  jti: string
  expires_at: string | null
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
}

export function storeApiToken(opts: {
  userId: string
  name: string
  jti: string
  token: string
  expiresAt?: Date
}): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO api_tokens
      (id, user_id, name, token_hash, jti, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).run(id, opts.userId, opts.name, hashToken(opts.token), opts.jti, opts.expiresAt?.toISOString() ?? null)
  return id
}

export function listApiTokens(userId: string): ApiTokenRecord[] {
  return db
    .prepare(
      `SELECT id, user_id, name, jti, expires_at, last_used_at, created_at, revoked_at
       FROM api_tokens
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all(userId) as ApiTokenRecord[]
}

export function revokeApiToken(id: string, userId: string): boolean {
  const result = db
    .prepare('UPDATE api_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .run(id, userId)
  return result.changes > 0
}

/** 校验 API 令牌是否仍然有效（未被撤销、未过期）。被吊销或过期返回 false。 */
export function isApiTokenValid(jti: string): boolean {
  const record = db
    .prepare("SELECT id, expires_at, revoked_at FROM api_tokens WHERE jti = ?")
    .get(jti) as { id: string; expires_at: string | null; revoked_at: string | null } | undefined
  if (!record) return false
  if (record.revoked_at) return false
  if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) return false
  db.prepare('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(record.id)
  return true
}
