import { Loader } from '@cloudflare/kumo'

interface LoadingProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * Monochrome loading spinner
 */
export function Loading({ size = 'md', className }: LoadingProps) {
  const loaderSize = size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : 'base'

  return (
    <Loader size={loaderSize} className={className} aria-label="加载中" />
  )
}

interface LoadingOverlayProps {
  message?: string
}

/**
 * Full-screen loading overlay
 */
export function LoadingOverlay({ message }: LoadingOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-kumo-canvas/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4">
        <Loading size="lg" />
        {message && <p className="text-sm text-kumo-subtle">{message}</p>}
      </div>
    </div>
  )
}
