import { Hono } from 'hono'
import { db } from '../db/sqlite'
import { requireAuth, getRequestUser } from '../middleware/auth'
import { getDailyQuota } from '../db/user-settings'

const usage = new Hono()

usage.use('*', requireAuth)

usage.get('/today', (c) => {
  const user = getRequestUser(c)

  const used = (
    db
      .prepare(
        `SELECT COUNT(*) as count
         FROM ai_usage
         WHERE user_id = ? AND exempt = 0 AND date(created_at) = date('now')`,
      )
      .get(user.id) as { count: number }
  ).count

  return c.json({ used, quota: getDailyQuota(), date: new Date().toISOString().split('T')[0] }, 200)
})

export default usage
