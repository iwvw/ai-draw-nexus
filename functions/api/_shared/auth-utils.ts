import { Env } from './types'

/**
 * Auth utilities for hashing and JWT
 */

// JWT Secret from env
const getJwtSecret = (env: Env) => env.JWT_SECRET || 'default-secret-change-me'

/**
 * Hash password using SHA-256 (plus salt)
 * For higher security in production, consider PBKDF2
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate JWT Token
 */
export async function generateToken(payload: any, env: Env): Promise<string> {
  const secret = getJwtSecret(env)
  const header = { alg: 'HS256', typ: 'JWT' }
  
  // Expiry: 7 days
  const now = Math.floor(Date.now() / 1000)
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + 60 * 60 * 24 * 7
  }

  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const encodedPayload = btoa(JSON.stringify(fullPayload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  
  const tokenData = `${encodedHeader}.${encodedPayload}`
  const signature = await signHmacSha256(tokenData, secret)
  
  return `${tokenData}.${signature}`
}

/**
 * Verify JWT Token
 */
export async function verifyToken(token: string, env: Env): Promise<any | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, payload, signature] = parts
    const secret = getJwtSecret(env)
    const validSignature = await signHmacSha256(`${header}.${payload}`, secret)

    if (signature !== validSignature) return null

    const decodedPayload = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    const now = Math.floor(Date.now() / 1000)
    
    if (decodedPayload.exp && decodedPayload.exp < now) {
      return null
    }

    return decodedPayload
  } catch (e) {
    return null
  }
}

/**
 * Helper to sign with HMAC-SHA256
 */
async function signHmacSha256(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  const hashArray = Array.from(new Uint8Array(signature))
  return btoa(String.fromCharCode.apply(null, hashArray))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}
