import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { db } from '../db'
import { getAuthPayload } from '../auth-utils'

const projects = new Hono()

// Zod Schemas
const CreateProjectSchema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  engine_type: z.enum(['drawio', 'excalidraw', 'mermaid', 'tldraw']),
  thumbnail: z.string().optional(),
  id: z.string().uuid().optional()
})

const UpdateProjectSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  thumbnail: z.string().optional()
}).refine(data => data.title !== undefined || data.thumbnail !== undefined, {
  message: "No fields to update"
})

// Middleware to secure all project routes
projects.use('*', async (c, next) => {
  const payload = await getAuthPayload(c)
  if (!payload) return c.json({ error: 'Unauthorized' }, 401)
  c.set('user', payload)
  await next()
})

projects.get('/', (c) => {
  const user = c.get('user')
  const results = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(user.userId)
  return c.json(results, 200)
})

projects.post('/', async (c) => {
  try {
    const user = c.get('user')
    const body = await c.req.json()
    const parsed = CreateProjectSchema.safeParse(body)
    
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const { title, engine_type, thumbnail, id: customId } = parsed.data
    const projectId = customId || uuidv4()
    
    const now = new Date().toISOString()
    db.prepare('INSERT INTO projects (id, user_id, title, engine_type, thumbnail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(projectId, user.userId, title, engine_type, thumbnail || '', now, now)
    
    return c.json({ id: projectId, title, engine_type }, 201)
  } catch (err) {
    console.error('Create project error', err)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

projects.get('/detail', (c) => {
  const user = c.get('user')
  const id = c.req.query('id')
  
  if (!id) return c.json({ error: 'id is required' }, 400)
  
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, user.userId)
  if (!project) return c.json({ error: 'Project not found' }, 404)
  
  return c.json(project, 200)
})

projects.put('/detail', async (c) => {
  const user = c.get('user')
  const id = c.req.query('id')
  if (!id) return c.json({ error: 'id is required' }, 400)

  try {
    const body = await c.req.json()
    const parsed = UpdateProjectSchema.safeParse(body)

    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const { title, thumbnail } = parsed.data
    const fields: string[] = []
    const params: any[] = []

    if (title !== undefined) { fields.push('title = ?'); params.push(title); }
    if (thumbnail !== undefined) { fields.push('thumbnail = ?'); params.push(thumbnail); }

    fields.push('updated_at = ?')
    params.push(new Date().toISOString(), id, user.userId)

    const result = db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...params)

    if (result.changes === 0) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    return c.json({ success: true }, 200)
  } catch (err) {
    console.error('Update project error', err)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

projects.delete('/detail', (c) => {
  const user = c.get('user')
  const id = c.req.query('id')
  if (!id) return c.json({ error: 'id is required' }, 400)

  db.transaction(() => {
    // Delete versions first to avoid orphan records or foreign key constraints
    db.prepare('DELETE FROM versions WHERE project_id = ?').run(id)
    const result = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, user.userId)
    if (result.changes === 0) throw new Error('NOT_FOUND')
  })()

  return c.json({ success: true }, 200)
})

export default projects
