import { Env } from '../_shared/types'
import { verifyToken } from '../_shared/auth-utils'

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

  const url = new URL(request.url)
  const id = url.searchParams.get('id')

  if (!id) {
    return new Response(JSON.stringify({ error: 'id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Handle GET (Detail)
  if (request.method === 'GET') {
    const project = await env.DB.prepare(
      'SELECT * FROM projects WHERE id = ? AND user_id = ?'
    )
      .bind(id, payload.userId)
      .first()
    
    if (!project) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    return new Response(JSON.stringify(project), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Handle PUT (Update)
  if (request.method === 'PUT') {
    const data = await request.json() as any
    const fields: string[] = []
    const params: any[] = []

    if (data.title !== undefined) {
      fields.push('title = ?')
      params.push(data.title)
    }
    if (data.thumbnail !== undefined) {
      fields.push('thumbnail = ?')
      params.push(data.thumbnail)
    }

    if (fields.length === 0) {
      return new Response(JSON.stringify({ error: 'No fields to update' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    fields.push('updated_at = CURRENT_TIMESTAMP')
    params.push(id, payload.userId)

    const result = await env.DB.prepare(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
    )
      .bind(...params)
      .run()

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Project not found or access denied' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Handle DELETE
  if (request.method === 'DELETE') {
    // Delete versions first (FX: ideally use a transaction if possible in D1)
    await env.DB.prepare('DELETE FROM versions WHERE project_id = ?').bind(id).run()
    
    const result = await env.DB.prepare(
      'DELETE FROM projects WHERE id = ? AND user_id = ?'
    )
      .bind(id, payload.userId)
      .run()

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ error: 'Project not found or access denied' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response('Method Not Allowed', { status: 405 })
}
