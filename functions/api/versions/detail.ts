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
  const versionId = url.searchParams.get('id')
  
  if (!versionId) {
    return new Response(JSON.stringify({ error: 'id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Handle GET (Fetch version detail)
  if (request.method === 'GET') {
    // Fetch version and verify ownership through project join
    const version = await env.DB.prepare(
      `SELECT v.* FROM versions v 
       JOIN projects p ON v.project_id = p.id 
       WHERE v.id = ? AND p.user_id = ?`
    )
      .bind(versionId, payload.userId)
      .first() as any
    
    if (!version) {
      return new Response(JSON.stringify({ error: 'Version not found or access denied' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify(version), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Handle PUT (Update version content)
  if (request.method === 'PUT') {
    const { content } = await request.json() as any
    
    // Verify ownership
    const version = await env.DB.prepare(
      `SELECT v.id FROM versions v 
       JOIN projects p ON v.project_id = p.id 
       WHERE v.id = ? AND p.user_id = ?`
    )
      .bind(versionId, payload.userId)
      .first()
    
    if (!version) {
      return new Response(JSON.stringify({ error: 'Version not found or access denied' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    await env.DB.prepare(
      'UPDATE versions SET content = ?, timestamp = CURRENT_TIMESTAMP WHERE id = ?'
    )
      .bind(content, versionId)
      .run()

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response('Method Not Allowed', { status: 405 })
}
