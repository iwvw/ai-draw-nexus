import { useAuthStore } from '@/stores/authStore'

export interface AdminStats {
  users: number
  activeUsers: number
  admins: number
  projects: number
  versions: number
  aiRequestsToday: number
}

export interface AdminUser {
  id: string
  username: string
  email: string | null
  name: string
  role: 'admin' | 'member'
  status: 'active' | 'suspended'
  created_at: string
  updated_at: string
  last_login_at: string | null
  project_count: number
}

export interface AdminProject {
  id: string
  title: string
  engine_type: string
  visibility: string
  status: string
  created_at: string
  updated_at: string
  owner_id: string
  owner_username: string
  owner_email: string | null
  version_count: number
}

export interface AdminSetting {
  key: string
  value: string
  updated_at: string
  updated_by_username: string | null
}

export interface AdminUsageRecord {
  id: string
  provider: string
  model_id: string | null
  request_kind: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  exempt: number
  created_at: string
  username: string | null
}

export interface AdminAuditRecord {
  id: string
  action: string
  target_type: string
  target_id: string | null
  metadata: string
  created_at: string
  actor_username: string | null
}

export interface AiTrendPoint {
  day: string
  status: string
  count: number
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(data?.error || `后台请求失败：${response.status}`)
  }

  return data as T
}

export const AdminService = {
  getStats: () => adminRequest<AdminStats>('/stats'),
  getAiTrend: (days = 7) => adminRequest<AiTrendPoint[]>(`/stats/ai-trend?days=${days}`),
  listUsers: () => adminRequest<AdminUser[]>('/users?limit=200'),
  listProjects: () => adminRequest<AdminProject[]>('/projects?limit=200'),
  listSettings: () => adminRequest<AdminSetting[]>('/settings'),
  listUsage: () => adminRequest<AdminUsageRecord[]>('/usage?limit=200'),
  listAudit: () => adminRequest<AdminAuditRecord[]>('/audit?limit=200'),

  updateUser: (id: string, data: Partial<Pick<AdminUser, 'role' | 'status' | 'name' | 'email'>>) =>
    adminRequest<{ success: true }>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  updateSetting: (key: string, value: unknown) =>
    adminRequest<{ key: string; value: string }>(`/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
}
