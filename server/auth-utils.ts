import { z } from 'zod'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

const DEV_SECRET_FILE = path.join(process.cwd(), '.dev.secret')
const HASH_ITERATIONS = 120_000
const HASH_KEY_LENGTH = 32
const HASH_DIGEST = 'sha256'

export type UserRole = 'admin' | 'member'
export type UserStatus = 'active' | 'suspended'

export interface AuthPayload {
  userId: string
  username: string
  name: string
  role: UserRole
  iat?: number
  exp?: number
}

export const getJwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须设置 JWT_SECRET。')
  }

  try {
    if (fs.existsSync(DEV_SECRET_FILE)) {
      return fs.readFileSync(DEV_SECRET_FILE, 'utf-8').trim()
    }
  } catch {
    // Fall through to generating a new dev secret.
  }

  const secret = crypto.randomBytes(32).toString('hex')
  try {
    fs.writeFileSync(DEV_SECRET_FILE, secret)
  } catch {
    // Non-fatal in local dev. A new token secret will be generated per restart.
  }

  return secret
}

export const LoginSchema = z.object({
  username: z.string().min(1, '请输入用户名或邮箱').max(120),
  password: z.string().min(1, '请输入密码').max(200),
})

export const RegisterSchema = z.object({
  username: z.string().min(3, '用户名至少需要 3 个字符').max(50),
  password: z.string().min(6, '密码至少需要 6 个字符').max(200),
})

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('base64url')
  const derived = crypto
    .pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_DIGEST)
    .toString('base64url')
  return `pbkdf2_${HASH_DIGEST}$${HASH_ITERATIONS}$${salt}$${derived}`
}

function legacySha256(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex')
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith(`pbkdf2_${HASH_DIGEST}$`)) {
    const [, iterationsRaw, salt, expected] = storedHash.split('$')
    const iterations = Number(iterationsRaw)
    if (!iterations || !salt || !expected) return false

    const actual = crypto
      .pbkdf2Sync(password, salt, iterations, HASH_KEY_LENGTH, HASH_DIGEST)
      .toString('base64url')

    if (actual.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  }

  return legacySha256(password) === storedHash
}

export function isLegacyPasswordHash(storedHash: string): boolean {
  return !storedHash.startsWith(`pbkdf2_${HASH_DIGEST}$`)
}

export async function generateToken(payload: Omit<AuthPayload, 'iat' | 'exp'>): Promise<string> {
  const secret = getJwtSecret()
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: AuthPayload = {
    ...payload,
    iat: now,
    exp: now + 60 * 60 * 24 * 7,
  }

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
  const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  const tokenData = `${encodedHeader}.${encodedPayload}`
  const signature = crypto.createHmac('sha256', secret).update(tokenData).digest('base64url')

  return `${tokenData}.${signature}`
}

export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, payload, signature] = parts
    const secret = getJwtSecret()
    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url')

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(validSignature))) {
      return null
    }

    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AuthPayload
    const now = Math.floor(Date.now() / 1000)

    if (decodedPayload.exp && decodedPayload.exp < now) return null
    if (!decodedPayload.userId || !decodedPayload.username || !decodedPayload.role) return null

    return decodedPayload
  } catch {
    return null
  }
}

export async function getAuthPayload(c: {
  req: { header: (name: string) => string | undefined }
}): Promise<AuthPayload | null> {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return verifyToken(authHeader.slice('Bearer '.length))
  }
  return null
}
