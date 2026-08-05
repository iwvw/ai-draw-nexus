import { v4 as uuidv4 } from 'uuid'
import { db } from './sqlite'

export function writeAuditLog(input: {
  actorUserId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  metadata?: Record<string, unknown>
}): void {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).run(
    uuidv4(),
    input.actorUserId || null,
    input.action,
    input.targetType,
    input.targetId || null,
    JSON.stringify(input.metadata || {}),
  )
}

