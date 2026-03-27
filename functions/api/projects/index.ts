import { Env } from '../_shared/types'
import { verifyToken } from '../_shared/auth-utils'
import { v4 as uuidv4 } from 'uuid'

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  // Auth check
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const token = authHeader.split(' ')[1]
  const payload = await verifyToken(token, env)
  if (!payload) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const userId = payload.userId

  // Handle GET (List)
  if (request.method === 'GET') {
    const projects = await env.DB.prepare(
      'SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC'
    )
      .bind(userId)
      .all()
    
    return new Response(JSON.stringify(projects.results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Handle POST (Create)
  if (request.method === 'POST') {
    const { title, engine_type, thumbnail, id: customId } = await request.json() as any
    const projectId = customId || uuidv4()
    
    await env.DB.prepare(
      'INSERT INTO projects (id, user_id, title, engine_type, thumbnail) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(projectId, userId, title, engine_type, thumbnail || '')
      .run()
    
    return new Response(JSON.stringify({ id: projectId, title, engine_type }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response('Method Not Allowed', { status: 405 })
}
