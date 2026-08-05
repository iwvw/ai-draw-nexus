import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useKumoToastManager } from '@cloudflare/kumo'

export interface ToastMessage {
  id?: string
  title?: string
  description?: string
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info'
}

type ToastManager = ReturnType<typeof useKumoToastManager>

/**
 * Hook to show toast notifications (backed by kumo's toast manager)
 *
 * Note: useKumoToastManager returns a fresh object on every render, so the
 * manager is captured in a ref to keep the returned callbacks referentially
 * stable (prevents effect loops in callers that depend on them).
 */
export function useToast() {
  const manager = useKumoToastManager()
  const managerRef = useRef<ToastManager | null>(null)
  useEffect(() => {
    managerRef.current = manager
  }, [manager])

  const toast = useCallback((options: Omit<ToastMessage, 'id'>) => {
    managerRef.current?.add({
      title: options.title,
      description: options.description,
      variant: options.variant ?? 'default',
      timeout: 2500,
    })
  }, [])

  const success = useCallback((description: string) => {
    managerRef.current?.add({ title: '成功', description, variant: 'success', timeout: 2500 })
  }, [])

  const error = useCallback((description: string) => {
    managerRef.current?.add({ title: '错误', description, variant: 'error', timeout: 2500 })
  }, [])

  return useMemo(() => ({ toast, success, error }), [toast, success, error])
}
