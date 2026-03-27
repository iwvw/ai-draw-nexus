import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
  id: string
  username: string
  name: string
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  
  setAuth: (user: User, token: string) => void
  logout: () => void
  setError: (error: string | null) => void
  checkAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      setAuth: (user, token) => {
        set({ user, token, isAuthenticated: true, error: null })
      },

      logout: () => {
        set({ user: null, token: null, isAuthenticated: false, error: null })
        localStorage.removeItem('auth-storage') // Clear persisted state
      },

      setError: (error) => set({ error }),

      checkAuth: async () => {
        const { token } = get()
        if (!token) return

        set({ isLoading: true })
        try {
          const res = await fetch('/api/auth/me', {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          })

          if (res.ok) {
            const data = await res.json()
            set({ user: data.user, isAuthenticated: true })
          } else {
            // Token expired or invalid
            set({ user: null, token: null, isAuthenticated: false })
          }
        } catch (err) {
          console.error('Auth check failed:', err)
        } finally {
          set({ isLoading: false })
        }
      }
    }),
    {
      name: 'auth-storage'
    }
  )
)
