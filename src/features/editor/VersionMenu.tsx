import { useCallback, useEffect, useState } from 'react'
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react'
import { Button, DropdownMenu, Loader, Tooltip } from '@cloudflare/kumo'
import { useEditorStore } from '@/stores/editorStore'
import { VersionService } from '@/services/versionService'
import type { VersionHistory } from '@/types'

export function VersionMenu() {
  const [versions, setVersions] = useState<VersionHistory[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const currentProject = useEditorStore((s) => s.currentProject)
  const versionSaveCount = useEditorStore((s) => s.versionSaveCount)
  const setContentFromVersion = useEditorStore((s) => s.setContentFromVersion)

  const loadVersions = useCallback(async () => {
    if (!currentProject) return

    setIsLoading(true)
    try {
      const data = await VersionService.getByProjectId(currentProject.id)
      setVersions(data)
    } catch (error) {
      console.error('Failed to load versions:', error)
    } finally {
      setIsLoading(false)
    }
  }, [currentProject])

  useEffect(() => {
    if (currentProject) {
      loadVersions()
    }
  }, [currentProject, versionSaveCount, loadVersions])

  const handleRestore = async (version: VersionHistory) => {
    try {
      // The list endpoint omits heavy content; fetch the full version first.
      const full = await VersionService.getById(version.id)
      if (!full?.content) return
      setContentFromVersion(full.content)
      setSelectedId(version.id)
    } catch (error) {
      console.error('Failed to load version content:', error)
    }
  }

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleString('zh-CN', {
      month: '2-digit',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <DropdownMenu onOpenChange={(open) => { if (open) loadVersions() }}>
      <Tooltip
        content="历史版本"
        render={(props) => (
          <DropdownMenu.Trigger
            render={(triggerProps: React.HTMLAttributes<HTMLButtonElement>) => (
              <Button {...props} {...triggerProps} variant="secondary" size="sm">
                <ClockCounterClockwiseIcon className="h-4 w-4" />
                <span className="hidden sm:inline">历史版本</span>
              </Button>
            )}
          />
        )}
      />
      <DropdownMenu.Content align="end" className="max-h-96 w-72 overflow-y-auto">
        <DropdownMenu.Group>
          <DropdownMenu.Label className="px-2 pt-1.5 text-xs text-kumo-subtle">
            版本历史 · {versions.length} 个版本
          </DropdownMenu.Label>
          <DropdownMenu.Separator />
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader size="sm" aria-label="加载中" />
            </div>
          ) : versions.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-kumo-subtle">没有版本记录</div>
          ) : (
            versions.map((version, index) => (
              <DropdownMenu.Item
                key={version.id}
                selected={selectedId === version.id}
                onClick={() => handleRestore(version)}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {index === 0 ? '当前版本' : `v${versions.length - index}`}
                    </span>
                    <span className="text-xs text-kumo-subtle">{formatTime(version.timestamp)}</span>
                  </span>
                  <span className="truncate text-xs text-kumo-subtle">{version.changeSummary}</span>
                </div>
              </DropdownMenu.Item>
            ))
          )}
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
