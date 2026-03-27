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

  // Handle GET (List versions for a project)
  if (request.method === 'GET') {
    const url = new URL(request.url)
    const projectId = url.searchParams.get('project_id')
    
    if (!projectId) {
      return new Response(JSON.stringify({ error: 'project_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Verify project ownership
    const project = await env.DB.prepare(
      'SELECT id FROM projects WHERE id = ? AND user_id = ?'
    )
      .bind(projectId, payload.userId)
      .first()
    
    if (!project) {
      return new Response(JSON.stringify({ error: 'Project not found or access denied' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const versions = await env.DB.prepare(
      'SELECT id, project_id, change_summary, timestamp FROM versions WHERE project_id = ? ORDER BY timestamp DESC'
    )
      .bind(projectId)
      .all()
    
    return new Response(JSON.stringify(versions.results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Handle POST (Create a version)
  if (request.method === 'POST') {
    const { project_id, content, change_summary } = await request.json() as any
    const versionId = uuidv4()

    // Verify project ownership
    const project = await env.DB.prepare(
      'SELECT id FROM projects WHERE id = ? AND user_id = ?'
    )
      .bind(project_id, payload.userId)
      .first()
    
    if (!project) {
      return new Response(JSON.stringify({ error: 'Project not found or access denied' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    
    await env.DB.prepare(
      'INSERT INTO versions (id, project_id, content, change_summary) VALUES (?, ?, ?, ?)'
    )
      .bind(versionId, project_id, content, change_summary || '')
      .run()

    // Update project updated_at
    await env.DB.prepare(
      'UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    )
      .bind(project_id)
      .run()
    
    return new Response(JSON.stringify({ id: versionId, project_id, timestamp: new Date().toISOString() }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return new Response('Method Not Allowed', { status: 405 })
}
