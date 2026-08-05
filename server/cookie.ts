export const AUTH_COOKIE_NAME = 'auth_token'
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days, matches JWT exp

export function setAuthCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production'
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

export function clearAuthCookie(): string {
  return `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
}

export function readAuthCookie(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const cookieHeader = c.req.header('Cookie')
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=')
    if (rawName === AUTH_COOKIE_NAME) {
      const value = rawValue.join('=')
      return value ? decodeURIComponent(value) : null
    }
  }
  return null
}
