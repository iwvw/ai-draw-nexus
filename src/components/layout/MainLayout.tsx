import { useRef } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
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
            <AppSidebar onCreateProject={handleCreateProject} />
            <div className="flex-1 pt-20">
                <PageTransition>
                    <Outlet />
                </PageTransition>
            </div>
        </div>
    )
}
