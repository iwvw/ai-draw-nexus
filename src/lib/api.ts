import { useAuthStore } from '@/stores/authStore'

// 统一的 API 前缀：所有 service 从这里取，避免部分硬编码 /api 部分读
// VITE_API_BASE_URL 导致跨域部署时接口一半可用一半不可用。
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

// getAuthHeaders 返回带 Bearer 的公共请求头。
// 所有需要登录的 fetch 都应走这里，保证鉴权一致（cookie + Bearer 双通道）。
export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = useAuthStore.getState().token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

// apiUrl 拼接接口路径，避免手写模板串遗漏前缀。
export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}