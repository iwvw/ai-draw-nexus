import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Dialog, Input, Radio, Tabs, Textarea } from '@cloudflare/kumo'
import { FileTextIcon, UploadSimpleIcon, XIcon } from '@phosphor-icons/react'
import { ENGINES } from '@/constants'
import { ProjectService } from '@/services/projectService'
import { VersionService } from '@/services/versionService'
import { useToast } from '@/hooks/useToast'
import { createAutoProjectTitle, getCurrentMinuteKey } from '@/lib/projectName'
import type { EngineType } from '@/types'

interface ImportProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ImportMode = 'file' | 'text'

const importTabs = [
  { value: 'file', label: '文件' },
  { value: 'text', label: '文本' },
]

export function ImportProjectDialog({ open, onOpenChange }: ImportProjectDialogProps) {
  const navigate = useNavigate()
  const { success: showSuccess, error: showError } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [isTitleTouched, setIsTitleTouched] = useState(false)
  const [engine, setEngine] = useState<EngineType>('mermaid')
  const [importMode, setImportMode] = useState<ImportMode>('file')
  const [textContent, setTextContent] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(getCurrentMinuteKey())
      setIsTitleTouched(false)
    }
  }, [open])

  const resetForm = () => {
    setEngine('mermaid')
    setImportMode('file')
    setTextContent('')
    setSelectedFile(null)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) resetForm()
    onOpenChange(newOpen)
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setSelectedFile(file)
    const fileName = file.name.replace(/\.[^/.]+$/, '')
    if (fileName) {
      setTitle(fileName)
      setIsTitleTouched(true)
    }
  }

  const handleImport = async () => {
    if (!title.trim()) return

    const content = importMode === 'file' ? await selectedFile?.text() : textContent.trim()
    if (!content) return

    setIsImporting(true)
    try {
      const project = await ProjectService.create({
        title: isTitleTouched ? title.trim() : createAutoProjectTitle(),
        engineType: engine,
      })

      await VersionService.create({
        projectId: project.id,
        content,
        changeSummary: '导入内容',
      })

      onOpenChange(false)
      resetForm()
      showSuccess(`项目「${project.title}」已导入`)
      navigate(`/editor/${project.id}`)
    } catch (error) {
      console.error('Failed to import project:', error)
      showError(error instanceof Error ? error.message : '项目导入失败')
    } finally {
      setIsImporting(false)
    }
  }

  const isSubmitDisabled =
    !title.trim() ||
    isImporting ||
    (importMode === 'file' && !selectedFile) ||
    (importMode === 'text' && !textContent.trim())

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog size="lg" className="p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <Dialog.Title className="text-xl font-semibold text-kumo-default">导入项目</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-kumo-subtle">
              将已有 Mermaid、Excalidraw、Draw.io、XML、JSON 或文本内容导入工作区。
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
            placeholder="导入的图表"
            required
          />

          <Radio.Group
            legend="绘图引擎"
            appearance="card"
            orientation="horizontal"
            value={engine}
            onValueChange={(value) => setEngine(value as EngineType)}
            className="grid gap-3 md:grid-cols-3"
          >
            {ENGINES.map((item) => (
              <Radio.Item key={item.value} value={item.value} label={item.label} />
            ))}
          </Radio.Group>

          <div className="space-y-3">
            <Tabs
              tabs={importTabs}
              value={importMode}
              onValueChange={(value) => setImportMode(value as ImportMode)}
              variant="segmented"
              className="w-max"
            />

            {importMode === 'file' ? (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileChange}
                  className="hidden"
                  accept=".mmd,.mermaid,.excalidraw,.drawio,.xml,.json,.txt"
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-36 !w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-kumo-line bg-kumo-base p-6 text-center text-sm transition-colors hover:bg-kumo-tint"
                >
                  <UploadSimpleIcon className="size-8 text-kumo-subtle" />
                  <span className="font-medium text-kumo-default">{selectedFile?.name || '选择文件'}</span>
                  <span className="text-kumo-subtle">支持格式：.mmd、.excalidraw、.drawio、.xml、.json、.txt</span>
                </Button>
              </div>
            ) : (
              <Textarea
                label="源内容"
                value={textContent}
                onChange={(event) => setTextContent(event.target.value)}
                placeholder="粘贴图表源码或文本内容..."
                rows={8}
              />
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            icon={importMode === 'file' ? UploadSimpleIcon : FileTextIcon}
            loading={isImporting}
            disabled={isSubmitDisabled}
            onClick={handleImport}
          >
            导入
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
