import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../../db'
import { hashPassword, generateToken, getAuthPayload, LoginSchema, RegisterSchema } from '../auth-utils'

const auth = new Hono()

auth.post('/register', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = RegisterSchema.safeParse(body)
    
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const { username, password, name } = parsed.data

    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, username)
    if (existingUser) {
      return c.json({ error: 'User already exists' }, 409)
    }

    const userId = uuidv4()
    const passwordHash = await hashPassword(password)
    
    db.prepare('INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)')
      .run(userId, username, passwordHash, name || '')

    const token = await generateToken({ userId, username, name })

    return c.json({
      user: { id: userId, username, name: name || '' },
      token
    }, 201)
  } catch (error) {
    console.error('Registration error:', error)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

auth.post('/login', async (c) => {
  try {
    const body = await c.req.json()
    const parsed = LoginSchema.safeParse(body)
    
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const { username, password } = parsed.data
    const passwordHash = await hashPassword(password)
    
    const user = db.prepare('SELECT id, email as username, name FROM users WHERE (email = ? OR id = ?) AND password_hash = ?')
      .get(username, username, passwordHash) as any

    if (!user) {
      return c.json({ error: 'Invalid username or password' }, 401)
    }

    const token = await generateToken({ userId: user.id, username: user.username, name: user.name })

    return c.json({
      user: { id: user.id, username: user.username, name: user.name },
      token
    }, 200)
  } catch (error) {
    console.error('Login error:', error)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

auth.get('/me', async (c) => {
  const payload = await getAuthPayload(c)
  if (!payload) return c.json({ error: 'Unauthorized' }, 401)

  return c.json({
    user: {
      id: payload.userId,
      username: payload.username,
      name: payload.name
    }
  }, 200)
})

export default auth
