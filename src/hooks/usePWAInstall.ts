import { useState, useEffect } from 'react'

export function usePWAInstall() {
    const [installPrompt, setInstallPrompt] = useState<any>(null)
    const [isInstallable, setIsInstallable] = useState(false)

    useEffect(() => {
        const handler = (e: any) => {
            e.preventDefault()
            setInstallPrompt(e)
            setIsInstallable(true)
        }

        window.addEventListener('beforeinstallprompt', handler)

        return () => {
            window.removeEventListener('beforeinstallprompt', handler)
        }
    }, [])

    const install = async () => {
        if (!installPrompt) return

        installPrompt.prompt()
        const { outcome } = await installPrompt.userChoice

        if (outcome === 'accepted') {
            setIsInstallable(false)
            setInstallPrompt(null)
        }
    }

    return { isInstallable, install }
}
