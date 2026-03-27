import { Env } from '../_shared/types'
import { hashPassword, generateToken } from '../_shared/auth-utils'

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const { username, password } = await request.json() as any

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Username and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database binding (DB) is missing' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Fetch user
    const passwordHash = await hashPassword(password)
    const user = await env.DB.prepare(
      'SELECT id, username, name FROM users WHERE username = ? AND password_hash = ?'
    )
      .bind(username, passwordHash)
      .first() as any

    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid username or password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Generate token
    const token = await generateToken({ userId: user.id, username: user.username, name: user.name }, env)

    return new Response(JSON.stringify({
      user: { id: user.id, username: user.username, name: user.name },
      token
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Login error:', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
