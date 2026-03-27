import { Env } from '../_shared/types'
import { hashPassword, generateToken } from '../_shared/auth-utils'
import { v4 as uuidv4 } from 'uuid'

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    const { username, password, name } = await request.json() as any

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Username and password are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Check if D1 is available
    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'Database binding (DB) is missing' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Check if user already exists
    const existingUser = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
      .bind(username)
      .first()

    if (existingUser) {
      return new Response(JSON.stringify({ error: 'User already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Create user
    const userId = uuidv4()
    const passwordHash = await hashPassword(password)
    
    await env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, name) VALUES (?, ?, ?, ?)'
    )
      .bind(userId, username, passwordHash, name || '')
      .run()

    // Generate token
    const token = await generateToken({ userId, username, name }, env)

    return new Response(JSON.stringify({
      user: { id: userId, username, name: name || '' },
      token
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Registration error:', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
