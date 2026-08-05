import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Badge, Button, Dialog, Empty, Input, LayerCard, Loader } from '@cloudflare/kumo'
import {
  ArrowClockwiseIcon,
  CheckIcon,
  FolderOpenIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
  UploadSimpleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { CreateProjectDialog, ImportProjectDialog } from '@/components/layout'
import { engineBadgeVariant } from '@/constants'
import { useToast } from '@/hooks/useToast'
import { formatDate } from '@/lib/utils'
import { ProjectService } from '@/services/projectService'
import type { Project } from '@/types'

export function ProjectsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Project | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [isRenaming, setIsRenaming] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { success: showSuccess, error: showError } = useToast()

  const loadProjects = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await ProjectService.getAll()
      setProjects(data)
    } catch (error) {
      console.error('Failed to load projects:', error)
      showError('项目加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [showError])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (location.state?.openCreateDialog) {
      setIsCreateDialogOpen(true)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.pathname, location.state, navigate])

  const handleDelete = async (project: Project) => {
    setIsDeleting(true)
    try {
      await ProjectService.delete(project.id)
      await loadProjects()
      showSuccess('项目已删除')
    } catch (error) {
      console.error('Failed to delete project:', error)
      showError('项目删除失败')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDeleteClick = (project: Project) => {
    if (confirmDeleteId === project.id) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      setConfirmDeleteId(null)
      handleDelete(project)
    } else {
      setConfirmDeleteId(project.id)
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 3000)
    }
  }

  const handleRename = async () => {
    if (!renameTarget || !newTitle.trim()) return

    setIsRenaming(true)
    try {
      await ProjectService.update(renameTarget.id, { title: newTitle.trim() })
      setRenameTarget(null)
      setNewTitle('')
      await loadProjects()
      showSuccess('项目已重命名')
    } catch (error) {
      console.error('Failed to rename project:', error)
      showError('项目重命名失败')
    } finally {
      setIsRenaming(false)
    }
  }

  const openRenameDialog = (project: Project) => {
    setRenameTarget(project)
    setNewTitle(project.title)
  }

  return (
    <div className="px-5 py-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-kumo-default">项目</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={UploadSimpleIcon} onClick={() => setIsImportDialogOpen(true)}>
            导入
          </Button>
          <Button variant="primary" icon={PlusIcon} onClick={() => setIsCreateDialogOpen(true)}>
            新建项目
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader size={24} />
        </div>
      ) : projects.length === 0 ? (
        <LayerCard className="flex min-h-48 items-center justify-center p-8">
          <Empty
            icon={<FolderOpenIcon className="size-8" />}
            title="还没有项目"
            description="新建或导入一个图表项目即可开始。"
            contents={
              <Button variant="primary" icon={PlusIcon} onClick={() => setIsCreateDialogOpen(true)}>
                新建项目
              </Button>
            }
          />
        </LayerCard>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          <button
            type="button"
            onClick={() => setIsCreateDialogOpen(true)}
            className="group flex min-h-48 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-kumo-line bg-transparent text-kumo-subtle transition-colors hover:border-kumo-focus/40 hover:bg-kumo-tint hover:text-kumo-default focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand"
          >
            <PlusIcon className="size-7 transition-transform group-hover:scale-110" />
            <span className="text-sm font-medium">新建项目</span>
          </button>

          {projects.map((project) => (
            <LayerCard key={project.id} className="group overflow-hidden transition-shadow hover:shadow-md">
              <LayerCard.Secondary className="justify-between">
                <span className="min-w-0 flex-1 truncate font-medium">{project.title}</span>
                <Badge variant={engineBadgeVariant(project.engineType)}>{project.engineType}</Badge>
              </LayerCard.Secondary>
              <LayerCard.Primary className="gap-3">
                <button
                  type="button"
                  className="flex h-28 w-full items-center justify-center overflow-hidden rounded-lg bg-kumo-recessed text-left transition-colors group-hover:bg-kumo-tint focus:outline-none"
                  onClick={() => navigate(`/editor/${project.id}`)}
                >
                  {project.thumbnail ? (
                    <img src={project.thumbnail} alt={project.title} className="size-full object-cover" />
                  ) : (
                    <SparkleIcon className="size-8 text-kumo-subtle" />
                  )}
                </button>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-kumo-subtle">{formatDate(project.updatedAt)}</p>
                  <div
                    className={`flex flex-shrink-0 gap-1 transition-opacity ${
                      confirmDeleteId === project.id
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                    }`}
                  >
                    <Button
                      aria-label={`重命名 ${project.title}`}
                      shape="square"
                      size="sm"
                      variant="secondary"
                      icon={PencilSimpleIcon}
                      onClick={() => openRenameDialog(project)}
                    />
                    <Button
                      aria-label={
                        confirmDeleteId === project.id ? `再次点击确认删除 ${project.title}` : `删除 ${project.title}`
                      }
                      shape="square"
                      size="sm"
                      variant={confirmDeleteId === project.id ? 'secondary-destructive' : 'secondary'}
                      icon={confirmDeleteId === project.id ? CheckIcon : TrashIcon}
                      loading={isDeleting}
                      onClick={() => handleDeleteClick(project)}
                    />
                  </div>
                </div>
              </LayerCard.Primary>
            </LayerCard>
          ))}
        </div>
      )}

      <CreateProjectDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} />
      <ImportProjectDialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen} />

      <Dialog.Root open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <Dialog size="base" className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold text-kumo-default">重命名项目</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-kumo-subtle">
                项目名称会显示在你的工作区和后台项目列表中。
              </Dialog.Description>
            </div>
            <Button
              aria-label="关闭"
              shape="square"
              size="sm"
              variant="ghost"
              icon={XIcon}
              onClick={() => setRenameTarget(null)}
            />
          </div>
          <Input
            label="项目名称"
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleRename()
            }}
          />
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button variant="primary" icon={ArrowClockwiseIcon} loading={isRenaming} onClick={handleRename}>
              保存
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}
