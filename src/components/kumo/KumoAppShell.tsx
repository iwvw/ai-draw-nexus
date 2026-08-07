import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { CSSProperties } from 'react'
import { Badge, Button } from '@cloudflare/kumo'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
} from '@cloudflare/kumo'
import {
  FolderOpenIcon,
  GearSixIcon,
  HouseIcon,
  PlusIcon,
  ShieldCheckIcon,
  SignInIcon,
  SignOutIcon,
  SquaresFourIcon,
  UserIcon,
} from '@phosphor-icons/react'
import { useAuthStore } from '@/stores/authStore'

const navItems = [
  { label: '首页', path: '/', icon: HouseIcon },
  { label: '项目', path: '/projects', icon: FolderOpenIcon },
  { label: '模板', path: '/templates', icon: SquaresFourIcon },
  { label: '设置', path: '/profile', icon: GearSixIcon },
]

const roleLabels: Record<string, string> = {
  admin: '管理员',
  member: '成员',
}

const getPageTitle = (pathname: string) => {
  if (pathname === '/') return '首页'
  if (pathname.startsWith('/editor/')) return '项目详情'
  return navItems.find((item) => item.path === pathname)?.label ?? ''
}

export function KumoAppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, user, logout } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const pageTitle = getPageTitle(location.pathname)

  const handleCreateProject = () => {
    navigate('/projects', { state: { openCreateDialog: true } })
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <SidebarProvider
      collapsible="icon"
      mobileBreakpoint={1024}
      style={{ '--sidebar-width': '11.5rem', '--sidebar-width-icon': '57px' } as CSSProperties}
      className="flex h-screen w-screen overflow-hidden bg-kumo-canvas text-kumo-default"
    >
      <Sidebar>
        <SidebarHeader className="h-[58px]! shrink-0 overflow-hidden px-3! transition-[padding] duration-(--sidebar-animation-duration) ease-(--sidebar-easing) group-data-[state=collapsed]/sidebar:px-2!">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('/')}
            aria-label="返回首页"
            className="!h-full w-full min-w-0 justify-start gap-1 rounded-none text-left !bg-transparent !p-0 hover:!bg-transparent active:!bg-transparent focus:!bg-transparent focus-visible:!bg-transparent data-[active=true]:!bg-transparent data-[selected=true]:!bg-transparent"
          >
            <span className="flex size-10 shrink-0 items-center justify-center transition-transform duration-(--sidebar-animation-duration) ease-(--sidebar-easing)">
              <ShieldCheckIcon className="size-7 shrink-0 text-kumo-brand" />
            </span>
            <span className="block min-w-0 max-w-48 overflow-hidden truncate whitespace-nowrap text-xl font-semibold text-kumo-strong opacity-100 transition-[max-width,opacity] duration-(--sidebar-animation-duration) ease-(--sidebar-easing) group-data-[state=collapsed]/sidebar:max-w-0 group-data-[state=collapsed]/sidebar:opacity-0">
              绘图工作台
            </span>
          </Button>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon
                const active = location.pathname === item.path
                return (
                  <SidebarMenuButton
                    key={item.path}
                    icon={Icon}
                    active={active}
                    tooltip={item.label}
                    onClick={() => navigate(item.path)}
                  >
                    {item.label}
                  </SidebarMenuButton>
                )
              })}
              {isAdmin && (
                <SidebarMenuButton
                  icon={ShieldCheckIcon}
                  active={location.pathname === '/admin'}
                  tooltip="后台"
                  onClick={() => navigate('/admin')}
                >
                  后台
                </SidebarMenuButton>
              )}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup className="mt-auto">
            <SidebarMenu>
              {isAuthenticated ? (
                <SidebarMenuButton
                  icon={SignOutIcon}
                  tooltip="退出登录"
                  className="text-kumo-danger hover:bg-kumo-danger/10"
                  onClick={handleLogout}
                >
                  退出登录
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton
                  icon={SignInIcon}
                  tooltip="登录"
                  onClick={() => navigate('/auth')}
                >
                  登录
                </SidebarMenuButton>
              )}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="px-[11px]!">
          <SidebarTrigger />
        </SidebarFooter>
      </Sidebar>

      <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-[58px] shrink-0 items-center justify-between border-b border-kumo-line bg-kumo-base/95 px-3 min-[450px]:px-4 md:px-6 backdrop-blur">
          <div className="flex min-w-0 items-center gap-3.5">
            <SidebarTrigger className="lg:hidden" />
            <h1 className="truncate text-sm font-semibold text-kumo-default">{pageTitle}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button variant="primary" size="sm" onClick={handleCreateProject}>
              <PlusIcon className="size-4" />
              新建项目
            </Button>
            {isAuthenticated ? (
              <Button
                type="button"
                variant="outline"
                className="h-auto gap-2 px-2 py-1.5"
                onClick={() => navigate('/profile')}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-kumo-brand text-xs font-semibold text-kumo-inverse">
                  {user?.username?.slice(0, 1).toUpperCase() || <UserIcon className="size-4" />}
                </span>
                <span className="hidden text-sm font-medium sm:block">{user?.name || user?.username}</span>
                {user?.role && (
                  <Badge variant={user.role === 'admin' ? 'blue' : 'neutral'} className="hidden lg:inline-flex">
                    {roleLabels[user.role] ?? user.role}
                  </Badge>
                )}
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={() => navigate('/auth')}>
                登录
              </Button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-x-hidden overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </SidebarProvider>
  )
}
