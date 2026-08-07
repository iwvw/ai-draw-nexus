import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRightIcon,
  LinkIcon,
  PaperclipIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  SparkleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { Badge, Button, Input, LayerCard, Loader, Popover, Select, Textarea } from '@cloudflare/kumo'
import { CreateProjectDialog } from '@/components/layout'
import { ENGINES, QUICK_ACTIONS, engineBadgeVariant } from '@/constants'
import { formatDate } from '@/lib/utils'
import { createAutoProjectTitle } from '@/lib/projectName'
import { FILE_DROP_EVENT } from '@/lib/dragEvents'
import type { EngineType, Project, UrlAttachment, Attachment, ImageAttachment, DocumentAttachment } from '@/types'
import { ProjectService } from '@/services/projectService'
import { useChatStore } from '@/stores/chatStore'
import { aiService } from '@/services/aiService'
import { useToast } from '@/hooks/useToast'
import {
  fileToBase64,
  parseDocument,
  validateImageFile,
  validateDocumentFile,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_DOCUMENT_EXTENSIONS,
} from '@/lib/fileUtils'

export function HomePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [selectedEngine, setSelectedEngine] = useState<EngineType>('drawio')
  const [isLoading, setIsLoading] = useState(false)
  const [recentProjects, setRecentProjects] = useState<Project[]>([])
  const [attachments, setAttachments] = useState<File[]>([])
  const [urlAttachments, setUrlAttachments] = useState<UrlAttachment[]>([])
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlInputValue, setUrlInputValue] = useState('')
  const [isParsingUrl, setIsParsingUrl] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const setInitialPrompt = useChatStore((state) => state.setInitialPrompt)
  const { success: showSuccess, error: showError } = useToast()

  // 新建项目弹窗状态
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  useEffect(() => {
    loadRecentProjects()
  }, [])

  useEffect(() => {
    const onFileDrop = (event: Event) => {
      const file = (event as CustomEvent<File>).detail
      setAttachments((prev) => [...prev, file])
      showSuccess(`已添加附件「${file.name}」，输入提示词后发送`)
    }
    window.addEventListener(FILE_DROP_EVENT, onFileDrop)
    return () => window.removeEventListener(FILE_DROP_EVENT, onFileDrop)
  }, [showSuccess])

  const loadRecentProjects = async () => {
    try {
      const projects = await ProjectService.getAll()
      setRecentProjects(projects.slice(0, 5))
    } catch (error) {
      console.error('Failed to load projects:', error)
    }
  }

  const handleQuickStart = async () => {
    if (!prompt.trim()) return

    setIsLoading(true)
    try {
      const project = await ProjectService.create({
        title: createAutoProjectTitle(),
        engineType: selectedEngine,
      })

      // 转换文件附件为 Attachment 类型
      const convertedAttachments: Attachment[] = []

      for (const file of attachments) {
        if (SUPPORTED_IMAGE_TYPES.includes(file.type)) {
          const dataUrl = await fileToBase64(file)
          const imageAtt: ImageAttachment = {
            type: 'image',
            dataUrl,
            fileName: file.name,
          }
          convertedAttachments.push(imageAtt)
        } else {
          const content = await parseDocument(file)
          const docAtt: DocumentAttachment = {
            type: 'document',
            content,
            fileName: file.name,
          }
          convertedAttachments.push(docAtt)
        }
      }

      // 添加 URL 附件
      convertedAttachments.push(...urlAttachments)

      // 传递 prompt 和附件
      const allAttachments = convertedAttachments.length > 0 ? convertedAttachments : null
      setInitialPrompt(prompt.trim(), allAttachments)
      navigate(`/editor/${project.id}`)
    } catch (error) {
      console.error('Failed to create project:', error)
      showError(error instanceof Error ? error.message : '创建项目失败，请稍后重试')
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleQuickStart()
    }
  }

  // 处理剪贴板粘贴
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (!items) return

    const filesToProcess: File[] = []

    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) {
          filesToProcess.push(file)
        }
      }
    }

    if (filesToProcess.length === 0) return

    e.preventDefault()

    for (const file of filesToProcess) {
      // 处理图片
      if (SUPPORTED_IMAGE_TYPES.includes(file.type)) {
        const validation = validateImageFile(file)
        if (!validation.valid) {
          showError(validation.error!)
          continue
        }
        // 为粘贴的图片生成文件名
        const fileName = file.name || `粘贴图片-${Date.now()}.png`
        const newFile = new File([file], fileName, { type: file.type })
        setAttachments(prev => [...prev, newFile])
      }
      // 处理文档
      else if (SUPPORTED_DOCUMENT_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext.replace('*', '')))) {
        const validation = validateDocumentFile(file)
        if (!validation.valid) {
          showError(validation.error!)
          continue
        }
        setAttachments(prev => [...prev, file])
      }
    }
  }

  const handleQuickAction = async (action: (typeof QUICK_ACTIONS)[0]) => {
    setSelectedEngine(action.engine)
    setPrompt(action.prompt)
    // 自动聚焦到输入框
    textareaRef.current?.focus()
  }

  const handleAttachmentClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) {
      setAttachments(prev => [...prev, ...Array.from(files)])
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const removeUrlAttachment = (index: number) => {
    setUrlAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const handleUrlSubmit = async () => {
    const url = urlInputValue.trim()
    if (!url) return

    setIsParsingUrl(true)
    try {
      const result = await aiService.parseUrl(url)
      if (result.data) {
        const urlAttachment: UrlAttachment = {
          type: 'url',
          content: result.data.content,
          url: result.data.url,
          title: result.data.title,
        }
        setUrlAttachments(prev => [...prev, urlAttachment])
        setUrlInputValue('')
        setShowUrlInput(false)
        showSuccess(`链接「${result.data.title || result.data.url}」已添加`)
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '链接解析失败')
      console.error(err)
    } finally {
      setIsParsingUrl(false)
    }
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] w-full bg-kumo-canvas">
      <main className="mx-auto flex w-full flex-col items-center px-5 py-10 sm:px-8 lg:py-14">
        <section className="flex w-full flex-col items-center">
          <div className="mb-8 flex flex-col items-center text-center">
            <h1 className="text-3xl font-semibold text-kumo-strong sm:text-4xl">
              想画点什么？
            </h1>
          </div>

          {/* Chat Input Box */}
          <div className="mb-6 w-full max-w-3xl">
            <LayerCard className="p-4 shadow-sm transition-shadow focus-within:shadow-md">
              {/* 附件预览区域 */}
              {(attachments.length > 0 || urlAttachments.length > 0) && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {attachments.map((file, index) => (
                    <div
                      key={`file-${index}`}
                      className="flex items-center gap-2 rounded-lg bg-kumo-recessed px-3 py-1.5 text-sm"
                    >
                      <PaperclipIcon className="h-3 w-3 text-kumo-subtle" />
                      <span className="max-w-[150px] truncate text-kumo-default">
                        {file.name}
                      </span>
                      <Button
                        type="button"
variant="ghost"
                        size="base"
                        shape="square"
                        title="移除附件"
                        onClick={() => removeAttachment(index)}
                        className="h-5 w-5 text-kumo-subtle hover:text-kumo-default"
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  {urlAttachments.map((urlAtt, index) => (
                    <div
                      key={`url-${index}`}
                      className="flex items-center gap-2 rounded-lg bg-kumo-recessed px-3 py-1.5 text-sm"
                    >
                      <LinkIcon className="h-3 w-3 text-kumo-subtle" />
                      <span className="max-w-[150px] truncate text-kumo-default">
                        {urlAtt.title}
                      </span>
                      <Button
                        type="button"
variant="ghost"
                        size="base"
                        shape="square"
                        title="移除链接"
                        onClick={() => removeUrlAttachment(index)}
                        className="h-5 w-5 text-kumo-subtle hover:text-kumo-default"
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <Textarea
                ref={textareaRef}
                placeholder="描述你想要绘制的图表...（支持粘贴图片）"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                disabled={isLoading}
                className="min-h-[76px] w-full resize-none bg-transparent text-kumo-default placeholder:text-kumo-subtle focus:outline-none !ring-0 focus:!ring-0"
                rows={2}
              />

              {/* 隐藏的文件输入 */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.txt"
              />

              {/* 底部工具栏 */}
              <div className="mt-3 grid gap-3 border-t border-kumo-line pt-3 sm:flex sm:items-center sm:justify-between">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                  {/* 上传附件 */}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleAttachmentClick}
                      className="group relative !w-full justify-center text-kumo-subtle hover:text-kumo-default sm:!w-auto sm:justify-start"
                    >
                    <PaperclipIcon className="h-4 w-4" />
                    <span>上传附件</span>
                  </Button>

                  {/* 添加链接 */}
                  <Popover open={showUrlInput} onOpenChange={setShowUrlInput}>
                    <Popover.Trigger
                      render={(props) => (
                        <Button
                          {...props}
                          type="button"
                          variant="ghost"
                          disabled={isParsingUrl}
                          className="group relative !w-full justify-center text-kumo-subtle hover:text-kumo-default disabled:opacity-50 sm:!w-auto sm:justify-start"
                        >
                          <LinkIcon className="h-4 w-4" />
                          <span>添加链接</span>
                        </Button>
                      )}
                    />
                    <Popover.Content
                      side="top"
                      align="start"
                      sideOffset={8}
                      className="grid w-[min(22rem,calc(100vw-3rem))] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl border border-kumo-line bg-kumo-elevated p-2 shadow-lg"
                    >
                      <Input
                        type="url"
                        placeholder="输入网址链接..."
                        value={urlInputValue}
                        onChange={(e) => setUrlInputValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleUrlSubmit()
                          } else if (e.key === 'Escape') {
                            setShowUrlInput(false)
                            setUrlInputValue('')
                          }
                        }}
                        disabled={isParsingUrl}
                        className="grow !bg-transparent !ring-0 focus:!ring-0"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={handleUrlSubmit}
                        disabled={!urlInputValue.trim() || isParsingUrl}
                      >
                        {isParsingUrl ? <Loader size="sm" aria-label="加载中" /> : <ArrowRightIcon className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setShowUrlInput(false)
                          setUrlInputValue('')
                        }}
                        disabled={isParsingUrl}
                      >
                        <XIcon className="h-4 w-4" />
                      </Button>
                    </Popover.Content>
                  </Popover>

                  {/* 选择绘图引擎 */}
                  <Select
                    value={selectedEngine}
                    onValueChange={(value) => setSelectedEngine(value as EngineType)}
                    className="col-span-2 w-full sm:col-span-1 sm:w-auto"
                    aria-label="选择绘图引擎"
                  >
                    {ENGINES.map((engine) => (
                      <Select.Option key={engine.value} value={engine.value}>
                        {engine.label}
                      </Select.Option>
                    ))}
                  </Select>
                </div>

                {/* 发送按钮 */}
                <Button
                  onClick={handleQuickStart}
                  disabled={!prompt.trim() || isLoading}
                  variant="primary"
                  className="!w-full justify-center sm:!w-auto"
                >
                  {isLoading ? (
                    <span>创建中...</span>
                  ) : (
                    <>
                      <PaperPlaneRightIcon className="h-4 w-4" />
                      <span>发送</span>
                    </>
                  )}
                </Button>
              </div>
            </LayerCard>
          </div>

          {/* Quick Actions */}
          <div className="mb-12 w-full max-w-4xl">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {QUICK_ACTIONS.map((action, index) => (
                <Button
                  type="button"
                  variant="ghost"
                  key={index}
                  onClick={() => handleQuickAction(action)}
                  disabled={isLoading}
                  className="h-full !w-full justify-start gap-3 rounded-lg border border-kumo-line bg-kumo-base p-3 text-left transition-all hover:border-kumo-brand hover:bg-kumo-tint disabled:opacity-50"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-kumo-recessed">
                    <action.icon className="h-5 w-5 text-kumo-link" />
                  </div>
                  <span className="line-clamp-2 text-sm text-kumo-default">{action.label}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* Recent Projects Section */}
          <div className="w-full max-w-6xl pb-12">
            <LayerCard>
              <LayerCard.Secondary>最近项目</LayerCard.Secondary>
              <LayerCard.Primary className="p-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {/* New Project Card */}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsCreateDialogOpen(true)}
                    className="flex h-36 !w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-kumo-line bg-transparent transition-all hover:border-kumo-brand hover:bg-kumo-tint"
                  >
                    <PlusIcon className="h-6 w-6 text-kumo-subtle" />
                    <span className="text-sm text-kumo-subtle">新建项目</span>
                  </Button>

                  {/* Recent Projects */}
                  {recentProjects.map((project) => (
                    <Button
                      type="button"
                      variant="ghost"
                      key={project.id}
                      onClick={() => navigate(`/editor/${project.id}`)}
                      className="group flex h-36 !w-full flex-col overflow-hidden rounded-lg bg-kumo-recessed text-left transition-all hover:ring-2 hover:ring-kumo-brand/40"
                    >
                      <div className="flex h-20 w-full items-center justify-center bg-kumo-base">
                        {project.thumbnail ? (
                          <img
                            src={project.thumbnail}
                            alt={project.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <SparkleIcon className="h-8 w-8 text-kumo-subtle" />
                        )}
                      </div>
                      <div className="flex w-full flex-1 flex-col justify-between p-3 text-left">
                        <div className="flex w-full items-center justify-between gap-2">
                          <p className="flex-1 truncate text-sm font-medium text-kumo-default">
                            {project.title === `Untitled-${project.id}`
                              ? '未命名'
                              : project.title}
                          </p>
                          <Badge variant={engineBadgeVariant(project.engineType)}>{project.engineType.toUpperCase()}</Badge>
                        </div>
                        <p className="text-xs text-kumo-subtle">
                          {formatDate(project.updatedAt)}
                        </p>
                      </div>
                    </Button>
                  ))}
                </div>
              </LayerCard.Primary>
            </LayerCard>
          </div>
        </section>
      </main>

      {/* Create Project Dialog */}
      <CreateProjectDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </div>
  )
}
