import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { db } from '../../db'
import { getAuthPayload } from '../auth-utils'

const versions = new Hono()

const CreateVersionSchema = z.object({
  project_id: z.string().uuid(),
  content: z.string(),
  change_summary: z.string().optional()
})

const UpdateVersionSchema = z.object({
  content: z.string().min(1)
})

// Middleware to secure all version routes
versions.use('*', async (c, next) => {
  const payload = await getAuthPayload(c)
  if (!payload) return c.json({ error: 'Unauthorized' }, 401)
  c.set('user', payload)
  await next()
})

versions.get('/', (c) => {
  const user = c.get('user')
  const projectId = c.req.query('project_id')
  
  if (!projectId) return c.json({ error: 'project_id is required' }, 400)

  // Verify project ownership
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, user.userId)
  if (!project) return c.json({ error: 'Project not found or access denied' }, 404)

  const results = db.prepare('SELECT id, project_id, change_summary, timestamp FROM versions WHERE project_id = ? ORDER BY timestamp DESC').all(projectId)
  return c.json(results, 200)
})

versions.post('/', async (c) => {
  try {
    const user = c.get('user')
    const body = await c.req.json()
    const parsed = CreateVersionSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const { project_id, content, change_summary } = parsed.data
    const versionId = uuidv4()

    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(project_id, user.userId)
    if (!project) return c.json({ error: 'Project not found or access denied' }, 404)

    const now = new Date().toISOString()
    
    db.transaction(() => {
      db.prepare('INSERT INTO versions (id, project_id, content, change_summary, timestamp) VALUES (?, ?, ?, ?, ?)')
        .run(versionId, project_id, content, change_summary || '', now)
      
      db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?')
        .run(now, project_id)
    })()

    return c.json({ id: versionId, project_id, timestamp: now }, 201)
  } catch (err) {
    console.error('Create version error', err)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

versions.get('/detail', (c) => {
  const user = c.get('user')
  const id = c.req.query('id')
  
  if (!id) return c.json({ error: 'id is required' }, 400)

  const version = db.prepare(`SELECT v.* FROM versions v JOIN projects p ON v.project_id = p.id WHERE v.id = ? AND p.user_id = ?`).get(id, user.userId)
  if (!version) return c.json({ error: 'Version not found or access denied' }, 404)

  return c.json(version, 200)
})

versions.put('/detail', async (c) => {
  try {
    const user = c.get('user')
    const id = c.req.query('id')
    if (!id) return c.json({ error: 'id is required' }, 400)

    const body = await c.req.json()
    const parsed = UpdateVersionSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const { content } = parsed.data

    const version = db.prepare(`SELECT v.id FROM versions v JOIN projects p ON v.project_id = p.id WHERE v.id = ? AND p.user_id = ?`).get(id, user.userId)
    if (!version) return c.json({ error: 'Version not found or access denied' }, 404)

    db.prepare('UPDATE versions SET content = ?, timestamp = ? WHERE id = ?')
      .run(content, new Date().toISOString(), id)

    return c.json({ success: true }, 200)
  } catch (err) {
    console.error('Update version error', err)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

export default versions
