import { useNavigate, useLocation, Link } from 'react-router-dom'
import { Plus, User as UserIcon, LogIn } from 'lucide-react'
import { NAV_ITEMS } from '@/constants'
import { useAuthStore } from '@/stores/authStore'

interface AppSidebarProps {
  onCreateProject?: () => void
}

export function AppSidebar({ onCreateProject }: AppSidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, user } = useAuthStore()

  return (
    <aside className="fixed right-6 top-6 z-50 flex flex-row items-center rounded-full border border-border bg-surface/80 p-1.5 shadow-lg backdrop-blur-md transition-all hover:shadow-xl">
      {/* New Project Button */}
      <button
        onClick={onCreateProject}
        className="flex h-10 w-10 origin-center cursor-pointer items-center justify-center rounded-full border border-border bg-surface transition-all hover:border-primary hover:shadow-md active:scale-95"
      >
        <Plus className="h-5 w-5 text-primary" />
      </button>

      {/* Divider */}
      <div className="mx-2 h-6 w-px bg-border/50" />

      {/* Navigation Items */}
      <nav className="flex flex-row items-center gap-1">
        {NAV_ITEMS.map((item, index) => (
          <button
            key={index}
            onClick={() => navigate(item.path)}
            className={`flex h-10 w-10 origin-center cursor-pointer items-center justify-center rounded-full transition-all active:scale-95 ${location.pathname === item.path
              ? 'bg-primary text-surface shadow-md'
              : 'text-muted-foreground hover:bg-background/80 hover:text-primary'
              }`}
            title={item.label}
          >
            <item.icon className="h-5 w-5" />
          </button>
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-2 h-6 w-px bg-border/50" />

      {/* User Auth Info - Moved to far right */}
      <Link
        to={isAuthenticated ? '/profile' : '/auth'}
        className={`flex h-10 w-10 items-center justify-center rounded-full border border-border transition-all hover:border-primary hover:shadow-md ${isAuthenticated ? 'bg-primary/10 text-primary' : 'bg-surface text-muted-foreground'}`}
        title={isAuthenticated ? `用户: ${user?.username}` : '登录/注册'}
      >
        {isAuthenticated ? (
          <div className="flex items-center justify-center h-full w-full font-bold">
            {user?.username?.[0]?.toUpperCase() || <UserIcon className="h-5 w-5" />}
          </div>
        ) : (
          <LogIn className="h-5 w-5" />
        )}
      </Link>
    </aside>
  )
}
