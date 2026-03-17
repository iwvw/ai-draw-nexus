import { Download } from 'lucide-react'
import { usePWAInstall } from '@/hooks/usePWAInstall'

export function PWAInstallButton() {
    const { isInstallable, install } = usePWAInstall()

    if (!isInstallable) return null

    return (
        <button
            onClick={install}
            className="fixed right-6 bottom-6 z-50 flex items-center gap-2 rounded-full border border-border bg-surface/80 p-3 px-6 shadow-lg backdrop-blur-md transition-all hover:shadow-xl hover:bg-surface active:scale-95 text-primary font-medium"
        >
            <Download className="h-5 w-5" />
            <span>安装应用</span>
        </button>
    )
}
