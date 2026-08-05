import { useEffect, type ReactNode } from 'react'
import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { TooltipProvider, Toasty } from '@cloudflare/kumo'
import { HomePage, ProjectsPage, EditorPage, ProfilePage, AuthPage, AdminPage } from '@/pages'
import { KumoAppShell } from '@/components/kumo/KumoAppShell'
import { useAuthStore } from '@/stores/authStore'
import { Loading } from '@/components/ui'

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}

function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const isInitialized = useAuthStore((state) => state.isInitialized)

  if (!isInitialized) {
    return (
      <div className="flex h-dvh items-center justify-center bg-kumo-canvas">
        <Loading size="lg" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />
  }

  return <>{children}</>
}

function HomePageRoute() {
  const isInitialized = useAuthStore((state) => state.isInitialized)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const allowPublic = useAuthStore((state) => state.allowPublic)

  if (!isInitialized) {
    return (
      <div className="flex h-dvh items-center justify-center bg-kumo-canvas">
        <Loading size="lg" />
      </div>
    )
  }

  if (!allowPublic && !isAuthenticated) {
    return <Navigate to="/auth" replace />
  }

  return <HomePage />
}

function App() {
  const checkAuth = useAuthStore((state) => state.checkAuth)

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  return (
    <TooltipProvider>
      <Toasty>
        <ScrollToTop />
        <Routes>
          <Route element={<KumoAppShell />}>
            <Route path="/" element={<HomePageRoute />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route
              path="/projects"
              element={
                <RequireAuth>
                  <ProjectsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <ProfilePage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAuth>
                  <AdminPage />
                </RequireAuth>
              }
            />
          </Route>
          <Route
            path="/editor/:projectId"
            element={
              <RequireAuth>
                <EditorPage />
              </RequireAuth>
            }
          />
        </Routes>
      </Toasty>
    </TooltipProvider>
  )
}

export default App
