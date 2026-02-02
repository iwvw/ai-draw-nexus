import { Routes, Route, useLocation } from 'react-router-dom'
import { TooltipProvider, Toaster } from '@/components/ui'
import { HomePage, ProjectsPage, EditorPage, ProfilePage } from '@/pages'
import { MainLayout } from '@/components/layout/MainLayout'
import { AnimatePresence } from 'framer-motion'

function App() {
  const location = useLocation()

  return (
    <TooltipProvider>
      <Routes location={location} key={location.pathname}>
        <Route element={<MainLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        <Route path="/editor/:projectId" element={<EditorPage />} />
      </Routes>
      <Toaster />
    </TooltipProvider>
  )
}

export default App
