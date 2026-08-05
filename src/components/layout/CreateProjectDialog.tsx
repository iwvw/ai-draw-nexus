import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Dialog, Input, Radio } from '@cloudflare/kumo'
import { PlusIcon, XIcon } from '@phosphor-icons/react'
import { ENGINES } from '@/constants'
import { ProjectService } from '@/services/projectService'
import { useToast } from '@/hooks/useToast'
import { createAutoProjectTitle, getCurrentMinuteKey } from '@/lib/projectName'
import type { EngineType } from '@/types'

const ENGINE_TIPS: Record<EngineType, string> = {
  mermaid: '适合流程图、时序图、ER 图和文档友好的文本化图表。',
  excalidraw: '适合快速表达想法、白板草图和自由排版。',
  drawio: '适合技术图、UML、网络拓扑和精确布局。',
}

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateProjectDialog({ open, onOpenChange }: CreateProjectDialogProps) {
  const navigate = useNavigate()
  const { success: showSuccess, error: showError } = useToast()
  const [title, setTitle] = useState('')
  const [isTitleTouched, setIsTitleTouched] = useState(false)
  const [engine, setEngine] = useState<EngineType>('drawio')
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(getCurrentMinuteKey())
      setIsTitleTouched(false)
    }
  }, [open])

  const resetForm = () => {
    setEngine('drawio')
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) resetForm()
    onOpenChange(newOpen)
  }

  const handleCreate = async () => {
    if (!title.trim()) return

    setIsCreating(true)
    try {
      const project = await ProjectService.create({
        title: isTitleTouched ? title.trim() : createAutoProjectTitle(),
        engineType: engine,
      })
      onOpenChange(false)
      resetForm()
      showSuccess(`项目「${project.title}」已创建`)
      navigate(`/editor/${project.id}`)
    } catch (error) {
      console.error('Failed to create project:', error)
      showError(error instanceof Error ? error.message : '项目创建失败')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog size="lg" className="p-6 sm:!w-[40rem]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <Dialog.Title className="text-xl font-semibold text-kumo-default">新建项目</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-kumo-subtle">
              选择绘图引擎，创建一个保存到 SQLite 工作区的项目。
            </Dialog.Description>
          </div>
          <Button
            aria-label="关闭"
            shape="square"
            size="sm"
            variant="ghost"
            icon={XIcon}
            onClick={() => onOpenChange(false)}
          />
        </div>

        <div className="space-y-5">
          <Input
            label="项目名称"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setIsTitleTouched(true)
            }}
            placeholder="架构图"
            required
          />

          <Radio.Group
            legend="绘图引擎"
            appearance="card"
            value={engine}
            onValueChange={(value) => setEngine(value as EngineType)}
            className="[&>div:last-child]:grid [&>div:last-child]:md:grid-cols-3"
          >
            {ENGINES.map((item) => (
              <Radio.Item
                key={item.value}
                value={item.value}
                label={item.label}
                description={ENGINE_TIPS[item.value]}
              />
            ))}
          </Radio.Group>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" icon={PlusIcon} loading={isCreating} onClick={handleCreate}>
            创建
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
