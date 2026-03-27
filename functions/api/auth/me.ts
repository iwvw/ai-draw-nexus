import { Env } from '../_shared/types'
import { verifyToken } from '../_shared/auth-utils'

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context

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

  return new Response(JSON.stringify({
    user: {
      id: payload.userId,
      username: payload.username,
      name: payload.name
    }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
