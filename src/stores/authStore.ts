import { create } from 'zustand'

interface User {
  id: string
  username: string
  email?: string | null
  name: string
  role?: 'admin' | 'member'
  status?: 'active' | 'suspended'
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  isInitialized: boolean
  error: string | null
  initialized: boolean
  allowPublic: boolean
  allowRegistration: boolean

  setAuth: (user: User, token: string) => void
  logout: () => Promise<void>
  setError: (error: string | null) => void
  checkAuth: () => Promise<boolean>
}

/**
 * Auth store keeps the session in memory only. The token is held in an
 * httpOnly cookie (server-side), so no credentials or user data are stored in
 * the browser. checkAuth() restores the session from the cookie on load.
 */
export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  isInitialized: false,
  error: null,
  initialized: false,
  allowPublic: true,
  allowRegistration: true,

  setAuth: (user, token) => {
    set({ user, token, isAuthenticated: true, error: null, initialized: true })
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (err) {
      console.error('Logout request failed:', err)
    }
    set({ user: null, token: null, isAuthenticated: false, error: null })
  },

  setError: (error) => set({ error }),

  checkAuth: async () => {
    set({ isLoading: true })
    try {
      const [statusRes, meRes] = await Promise.all([
        fetch('/api/auth/status', { credentials: 'include' }),
        fetch('/api/auth/me', { credentials: 'include' }),
      ])

      if (statusRes.ok) {
        const status = (await statusRes.json()) as {
          initialized: boolean
          allowPublic: boolean
          allowRegistration: boolean
        }
        set({
          initialized: status.initialized,
          allowPublic: status.allowPublic,
          allowRegistration: status.allowRegistration,
        })
      }

      if (meRes.ok) {
        const data = await meRes.json()
        set({ user: data.user, token: data.token ?? null, isAuthenticated: true, error: null })
        return true
      } else {
        set({ user: null, token: null, isAuthenticated: false })
        return false
      }
    } catch (err) {
      console.error('Auth check failed:', err)
      set({ user: null, token: null, isAuthenticated: false })
      return false
    } finally {
      set({ isLoading: false, isInitialized: true })
    }
  }
}))
