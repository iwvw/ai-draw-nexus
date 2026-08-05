import type { Context, Next } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/sqlite'
import { verifyToken } from '../auth-utils'
import { readAuthCookie } from '../cookie'
import { getDailyQuota, getUserLlmConfig } from '../db/user-settings'

interface AiUsageContext {
  userId: string | null
  provider: string
  modelId: string
  exempt: boolean
}

async function getAuthenticatedUserId(c: Context): Promise<string | null> {
  let token: string | null = null

  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice('Bearer '.length)
  } else {
    token = readAuthCookie(c)
  }

  if (!token) return null

  const payload = await verifyToken(token)
  if (!payload) return null

  const user = db
    .prepare("SELECT id FROM users WHERE id = ? AND status = 'active'")
    .get(payload.userId) as { id: string } | undefined

  return user?.id || null
}

function hasValidAccessPassword(c: Context): boolean {
  const configured = process.env.ACCESS_PASSWORD
  if (!configured) return false
  return c.req.header('X-Access-Password') === configured
}

function getTodayUsage(userId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM ai_usage
         WHERE user_id = ? AND exempt = 0 AND date(created_at) = date('now')`,
      )
      .get(userId) as { count: number }
  ).count
}

async function readUsageContext(c: Context): Promise<AiUsageContext> {
  const userId = await getAuthenticatedUserId(c)

  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => ({})) as {
    llmConfig?: {
      provider?: string
      modelId?: string
      apiKey?: string
    }
  }

  // Server-side source of truth: the user's saved LLM config in SQLite.
  // The client can no longer dictate exemption via body config.
  const savedConfig = userId ? getUserLlmConfig(userId) : null
  const bodyHasCustomLlm = Boolean(body.llmConfig?.apiKey)
  const hasCustomLlm = Boolean(savedConfig) || bodyHasCustomLlm
  const exempt = hasValidAccessPassword(c) || hasCustomLlm

  return {
    userId,
    provider: savedConfig?.provider || body.llmConfig?.provider || process.env.AI_PROVIDER || 'openai',
    modelId: savedConfig?.modelId || body.llmConfig?.modelId || process.env.AI_MODEL_ID || '',
    exempt,
  }
}

function recordUsage(context: AiUsageContext, status: 'success' | 'failed'): void {
  db.prepare(
    `INSERT INTO ai_usage
      (id, user_id, provider, model_id, request_kind, prompt_tokens, completion_tokens, total_tokens, exempt, status, created_at)
     VALUES (?, ?, ?, ?, 'chat', 0, 0, 0, ?, ?, CURRENT_TIMESTAMP)`,
  ).run(uuidv4(), context.userId, context.provider, context.modelId, context.exempt ? 1 : 0, status)
}

export async function aiUsageMiddleware(c: Context, next: Next) {
  if (c.req.method !== 'POST') {
    await next()
    return
  }

  const usageContext = await readUsageContext(c)

  if (usageContext.userId && !usageContext.exempt) {
    const quota = getDailyQuota()
    const used = getTodayUsage(usageContext.userId)
    if (used >= quota) {
      return c.json({ error: '今日 AI 配额已用完' }, 429)
    }
  }

  await next()

  recordUsage(usageContext, c.res?.ok ? 'success' : 'failed')
}
