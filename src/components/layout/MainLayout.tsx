import { useRef } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { AppSidebar } from './AppSidebar'
import { CreateProjectDialog } from './CreateProjectDialog'
import { PageTransition } from './PageTransition'

export function MainLayout() {
    const navigate = useNavigate()
    // Using a ref to expose open method is tricky with clean architecture, 
    // but for now we can keep the dialog logic or hoist it. 
    // However, AppSidebar previously took an onCreateProject prop. 
    // To keep it simple, we'll keep the dialog here or simple navigate to home with state?
    // Previous Home page Logic used useNavigate state to open dialog. 
    // Let's rely on that or handle it here.

    // Actually, AppSidebar calls onCreateProject. 
    // If we really want to support "New Project" from anywhere, we need the dialog accessible.
    // For now, let's just navigate to Home with a query param or state? 
    // Or render CreateProjectDialog here.

    // Let's keep it simple: "New Project" -> Navigate to /projects with state openCreateDialog: true
    // This matches what EditorPage does.

    const handleCreateProject = () => {
        navigate('/projects', { state: { openCreateDialog: true } })
    }

    return (
        <div className="flex min-h-screen flex-col bg-background">
            {/* Top Left Brand */}
            <div className="fixed left-6 top-6 z-50 flex items-center gap-2 rounded-full border border-border bg-surface/80 p-1.5 pr-4 shadow-sm backdrop-blur-md transition-all hover:shadow-md cursor-pointer" onClick={() => navigate('/')}>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-surface">
                    <Sparkles className="h-5 w-5" />
                </div>
                <span className="font-bold text-primary">AI Draw Nexus</span>
            </div>

            <AppSidebar onCreateProject={handleCreateProject} />
            <div className="flex-1 pt-20">
                <PageTransition>
                    <Outlet />
                </PageTransition>
            </div>
        </div>
    )
}
