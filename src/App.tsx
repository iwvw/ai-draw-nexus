import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { TooltipProvider, Toasty } from '@cloudflare/kumo'
import { HomePage, ProjectsPage, EditorPage, ProfilePage, AuthPage, AdminPage } from '@/pages'
import { KumoAppShell } from '@/components/kumo/KumoAppShell'
import { ImportProjectDialog } from '@/components/layout'
import { getFileExtension } from '@/lib/fileUtils'
import { dispatchDroppedFile } from '@/lib/dragEvents'
import { useAuthStore } from '@/stores/authStore'
import { Loading } from '@/components/ui'
import type { EngineType } from '@/types'

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

const IMPORT_EXTENSION_REGEX = /\.(mmd|mermaid|excalidraw|drawio|xml|json|txt)$/i
const DOCUMENT_EXTENSION_REGEX = /\.(docx|md)$/i

function inferEngine(content: string): EngineType {
  const trimmed = content.trimStart()
  if (trimmed.startsWith('<mxGraphModel') || trimmed.startsWith('<mxfile')) return 'drawio'
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed.type === 'excalidraw' || Array.isArray(parsed.elements)) return 'excalidraw'
    } catch {
      // 非 JSON,按 mermaid 处理
    }
  }
  return 'mermaid'
}

function GlobalImportLayer() {
  const [importData, setImportData] = useState<{ title: string; engine: EngineType; content: string } | null>(null)
  const [dragDepth, setDragDepth] = useState(0)
  const dragDepthRef = useRef(0)

  const updateDragDepth = (delta: number) => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current + delta)
    setDragDepth(dragDepthRef.current)
  }

  const handleDroppedFiles = async (event: DragEvent) => {
    const file = event.dataTransfer?.files?.[0]
    if (!file) return
    const extension = getFileExtension(file.name)
    if (DOCUMENT_EXTENSION_REGEX.test(extension)) {
      dispatchDroppedFile(file)
      return
    }
    if (!IMPORT_EXTENSION_REGEX.test(extension)) return
    try {
      const content = await file.text()
      setImportData({
        title: file.name.replace(/\.[^/.]+$/, ''),
        engine: inferEngine(content),
        content,
      })
    } catch (error) {
      console.error('Failed to read dropped file:', error)
    }
  }

  const handleDropRef = useRef(handleDroppedFiles)

  useEffect(() => {
    handleDropRef.current = handleDroppedFiles
  })

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      const items = Array.from(event.dataTransfer?.items ?? [])
      if (!items.some((item) => item.kind === 'file')) return
      if (items.every((item) => item.type.startsWith('image/'))) return
      updateDragDepth(1)
    }
    const onDragOver = (event: DragEvent) => {
      if (dragDepthRef.current > 0) event.preventDefault()
    }
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) {
        updateDragDepth(-dragDepthRef.current)
      }
    }
    const onDrop = (event: DragEvent) => {
      if (dragDepthRef.current > 0) {
        event.preventDefault()
        updateDragDepth(-dragDepthRef.current)
        void handleDropRef.current(event)
      }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return (
    <>
      {dragDepth > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-kumo-canvas/60 backdrop-blur-sm"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => event.preventDefault()}
        >
          <div className="pointer-events-none flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-kumo-primary bg-kumo-base/90 px-10 py-8 text-center shadow-xl">
            <span className="text-lg font-semibold text-kumo-default">松开以上传文件</span>
            <span className="text-sm text-kumo-subtle">
              支持 .mmd、.excalidraw、.drawio、.xml、.json、.txt、.docx、.md
            </span>
          </div>
        </div>
      )}
      <ImportProjectDialog
        open={importData !== null}
        initialData={importData}
        onOpenChange={(open) => {
          if (!open) setImportData(null)
        }}
      />
    </>
  )
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
        <GlobalImportLayer />
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
