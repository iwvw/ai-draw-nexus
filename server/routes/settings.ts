import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db/sqlite'
import { requireAuth, getRequestUser } from '../middleware/auth'
import { USER_SETTING_KEYS } from '../db/user-settings'

const LlmConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  baseUrl: z.string().max(500).default(''),
  apiKey: z.string().max(1000).default(''),
  modelId: z.string().max(200).default(''),
})

const UiPreferencesSchema = z.object({
  chatPanelCollapsed: z.boolean().optional(),
})

const UpdateSettingSchema = z
  .object({
    key: z.enum(USER_SETTING_KEYS),
    value: z.unknown(),
  })
  .refine((data) => data.value !== undefined, { message: '缺少 value' })

const settings = new Hono()

settings.use('*', requireAuth)

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

settings.get('/', (c) => {
  const user = getRequestUser(c)
  const rows = db
    .prepare('SELECT key, value, updated_at FROM user_settings WHERE user_id = ? ORDER BY key ASC')
    .all(user.id) as Array<{ key: string; value: string; updated_at: string }>

  const result: Record<string, unknown> = {}
  for (const row of rows) {
    result[row.key] = parseJson(row.value, row.value)
  }

  return c.json(result, 200)
})

settings.put('/', async (c) => {
  try {
    const user = getRequestUser(c)
    const body = await c.req.json()
    const parsed = UpdateSettingSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const { key, value } = parsed.data
    let normalized: string

    if (key === 'llm.config') {
      const config = LlmConfigSchema.safeParse(value)
      if (!config.success) {
        return c.json({ error: config.error.issues[0].message }, 400)
      }
      normalized = JSON.stringify(config.data)
    } else if (key === 'ui.preferences') {
      const prefs = UiPreferencesSchema.safeParse(value)
      if (!prefs.success) {
        return c.json({ error: prefs.error.issues[0].message }, 400)
      }
      normalized = JSON.stringify(prefs.data)
    } else {
      normalized = typeof value === 'string' ? value : JSON.stringify(value)
    }

    db.prepare(
      `INSERT INTO user_settings (user_id, key, value, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, key)
       DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).run(user.id, key, normalized)

    return c.json({ key, value: JSON.parse(normalized) }, 200)
  } catch (err) {
    console.error('Update user setting error', err)
    return c.json({ error: '服务器内部错误' }, 500)
  }
})

settings.delete('/:key', (c) => {
  const user = getRequestUser(c)
  const key = c.req.param('key')
  if (!USER_SETTING_KEYS.includes(key as (typeof USER_SETTING_KEYS)[number])) {
    return c.json({ error: '无效的设置项' }, 400)
  }

  db.prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?').run(user.id, key)
  return c.json({ success: true }, 200)
})

export default settings
