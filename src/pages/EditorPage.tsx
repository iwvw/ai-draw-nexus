import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { History, Pencil, Check, X, Plus, FolderOpen, Home, Save, Download, Image, Code, FileText, ChevronRight, Copy, Clipboard } from 'lucide-react'
import { Button, Input, Loading } from '@/components/ui'
import { ChatPanel } from '@/features/chat/ChatPanel'
import { CanvasArea, type CanvasAreaRef } from '@/features/editor/CanvasArea'
import { VersionPanel } from '@/features/editor/VersionPanel'
import { useEditorStore } from '@/stores/editorStore'
import { useChatStore } from '@/stores/chatStore'
import { ProjectRepository } from '@/services/projectRepository'
import { VersionRepository } from '@/services/versionRepository'
import { generateThumbnail } from '@/lib/thumbnail'
import { useToast } from '@/hooks/useToast'
import { useCollab } from '@/hooks/useCollab'
import { validateContent } from '@/lib/validators'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/Dropdown'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/Tooltip'

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false)
  const [isChatPanelCollapsed, setIsChatPanelCollapsed] = useState(() => {
    return localStorage.getItem('ai-draw-nexus.chatPanelCollapsed') === 'true'
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<CanvasAreaRef>(null)
  const isRemoteChange = useRef(false)
  const collabDebounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveDebounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const thumbnailDebounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [withBackground, setWithBackground] = useState(true)
  const { success, error: showError } = useToast()

  const { currentProject, currentContent, hasUnsavedChanges, setProject, setContentFromVersion, markAsSaved, reset: resetEditor } = useEditorStore()
  const { currentProjectId, switchProject } = useChatStore()

  const handleCollabMessage = (data: { content: string }) => {
    if (data.content && data.content !== useEditorStore.getState().currentContent) {
      isRemoteChange.current = true
      setContentFromVersion(data.content)
    }
  }

  const { sendMessage } = useCollab({
    projectId: projectId!,
    onMessage: handleCollabMessage,
  })

  useEffect(() => {
    localStorage.setItem('ai-draw-nexus.chatPanelCollapsed', String(isChatPanelCollapsed))
  }, [isChatPanelCollapsed])

  // Load project on mount
  useEffect(() => {
    if (!projectId) {
      navigate('/projects')
      return
    }

    loadProject(projectId)
  }, [projectId])

  // Dirty-data guard: warn user before closing tab with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        // Attempt a synchronous last-ditch save via sendBeacon
        if (currentProject && currentContent) {
          const token = localStorage.getItem('auth-storage')
          try {
            const parsed = token ? JSON.parse(token) : null
            const authToken = parsed?.state?.token
            if (authToken) {
              navigator.sendBeacon('/api/versions', JSON.stringify({
                project_id: currentProject.id,
                content: currentContent,
                change_summary: '自动保存 (页面关闭)'
              }))
            }
          } catch { /* best effort */ }
        }
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges, currentProject, currentContent])

  const loadProject = async (id: string) => {
    setIsLoading(true)
    // Clear previous project data before loading new one
    resetEditor()

    // Only switch project if switching to a differnet project
    if (id !== currentProjectId) {
      switchProject(id)
    }

    try {
      const project = await ProjectRepository.getById(id)
      if (!project) {
        navigate('/projects')
        return
      }

      setProject(project)
      setEditedTitle(project.title)

      // Load latest version content
      const latestVersion = await VersionRepository.getLatest(id)
      if (latestVersion) {
        setContentFromVersion(latestVersion.content)
      }
    } catch (error) {
      console.error('Failed to load project:', error)
      navigate('/projects')
    } finally {
      setIsLoading(false)
    }
  }

  // Focus title input when editing
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isEditingTitle])

  // Handle content changes: WebSocket sync (fast) and Auto-save to DB (slow)
  useEffect(() => {
    if (isRemoteChange.current) {
      isRemoteChange.current = false
      return
    }

    if (!hasUnsavedChanges || !currentContent || !currentProject) {
      return
    }

    // 1. Debounce for Real-time Collaboration (500ms)
    if (collabDebounceTimeout.current) {
      clearTimeout(collabDebounceTimeout.current)
    }
    collabDebounceTimeout.current = setTimeout(() => {
      sendMessage({ content: currentContent })
    }, 500)

    // 2. Debounce for Auto-save CONTENT ONLY to Database (2000ms)
    //    Thumbnail is intentionally NOT generated here to avoid performance overhead.
    if (autoSaveDebounceTimeout.current) {
      clearTimeout(autoSaveDebounceTimeout.current)
    }
    autoSaveDebounceTimeout.current = setTimeout(async () => {
      try {
        await VersionRepository.updateLatest(currentProject.id, currentContent)
        markAsSaved()
        console.log('Auto-saved content to database')
      } catch (err) {
        console.error('Auto-save failed:', err)
      }
    }, 2000)

    // 3. Debounce for Thumbnail update (30 seconds) - much less frequent
    if (thumbnailDebounceTimeout.current) {
      clearTimeout(thumbnailDebounceTimeout.current)
    }
    thumbnailDebounceTimeout.current = setTimeout(async () => {
      try {
        let thumbnail = ''
        if (currentProject.engineType === 'drawio' && canvasRef.current) {
          thumbnail = await canvasRef.current.getThumbnail()
        } else {
          thumbnail = await generateThumbnail(currentContent, currentProject.engineType)
        }
        if (thumbnail) {
          await ProjectRepository.update(currentProject.id, { thumbnail })
          setProject({ ...currentProject, thumbnail })
        }
      } catch (err) {
        console.error('Thumbnail update failed:', err)
      }
    }, 30000) // 30 seconds - thumbnail is expensive, do it infrequently

    return () => {
      if (collabDebounceTimeout.current) clearTimeout(collabDebounceTimeout.current)
      if (autoSaveDebounceTimeout.current) clearTimeout(autoSaveDebounceTimeout.current)
      if (thumbnailDebounceTimeout.current) clearTimeout(thumbnailDebounceTimeout.current)
    }
  }, [currentContent, hasUnsavedChanges, currentProject, sendMessage, markAsSaved])

  const handleNewProject = () => {
    navigate('/projects', { state: { openCreateDialog: true } })
  }

  const handleProjectManagement = () => {
    navigate('/projects')
  }

  const handleGoHome = () => {
    navigate('/')
  }

  const handleStartEditTitle = () => {
    if (currentProject) {
      setEditedTitle(currentProject.title)
      setIsEditingTitle(true)
    }
  }

  const handleSaveTitle = async () => {
    if (!currentProject || !editedTitle.trim()) return

    try {
      await ProjectRepository.update(currentProject.id, { title: editedTitle.trim() })
      setProject({ ...currentProject, title: editedTitle.trim() })
      setIsEditingTitle(false)
      success('Title updated')
    } catch (error) {
      console.error('Failed to update title:', error)
    }
  }

  const handleCancelEditTitle = () => {
    if (currentProject) {
      setEditedTitle(currentProject.title)
    }
    setIsEditingTitle(false)
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSaveTitle()
    } else if (e.key === 'Escape') {
      handleCancelEditTitle()
    }
  }

  const handlePasteXml = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text || !text.trim()) {
        showError('剪贴板为空')
        return
      }

      // Basic validation for XML or Mermaid code
      const engineType = currentProject?.engineType || 'drawio'
      const validation = await validateContent(text, engineType)

      if (validation.valid) {
        setContentFromVersion(text)
        success('内容已从剪贴板导入')
      } else {
        // Fallback for drawio: sometimes users paste partial XML or variants
        if (engineType === 'drawio' && (text.includes('<mxGraphModel') || text.includes('<mxfile') || text.includes('<diagram'))) {
          setContentFromVersion(text)
          success('XML 已导入')
        } else {
          showError(`剪贴板内容不是有效的 ${engineType.toUpperCase()} 格式`)
        }
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err)
      showError('无法读取剪贴板，请确保已授予权限并使用 HTTPS 访问')
    }
  }

  const handleSaveVersion = async () => {
    if (!currentProject?.id || !currentContent) return

    try {
      await VersionRepository.create({
        projectId: currentProject.id,
        content: currentContent,
        changeSummary: '人工调整',
      })
      markAsSaved()

      // Update thumbnail for all engines
      let thumbnail = ''
      if (currentProject.engineType === 'drawio' && canvasRef.current) {
        thumbnail = await canvasRef.current.getThumbnail()
      } else {
        thumbnail = await generateThumbnail(currentContent, currentProject.engineType)
      }

      if (thumbnail) {
        await ProjectRepository.update(currentProject.id, { thumbnail })
        setProject({ ...currentProject, thumbnail })
      }

      success('版本已保存')
    } catch (error) {
      console.error('Failed to save version:', error)
    }
  }

  // Generate thumbnail when canvas is ready (for projects without thumbnail, e.g., imported projects)
  const handleCanvasReady = async () => {
    if (!currentProject || !currentContent) return
    // Skip if project already has a thumbnail
    if (currentProject.thumbnail) return

    try {
      let thumbnail = ''
      if (currentProject.engineType === 'drawio' && canvasRef.current) {
        thumbnail = await canvasRef.current.getThumbnail()
      } else {
        thumbnail = await generateThumbnail(currentContent, currentProject.engineType)
      }

      if (thumbnail) {
        await ProjectRepository.update(currentProject.id, { thumbnail })
        setProject({ ...currentProject, thumbnail })
      }
    } catch (err) {
      console.error('Failed to generate thumbnail on ready:', err)
    }
  }

  if (isLoading || !currentProject) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loading size="lg" />
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background">
        {/* Toolbar */}
        <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 mr-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleGoHome}>
                    <Home className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>首页</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleProjectManagement}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>项目管理</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={handleNewProject}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>新建项目</TooltipContent>
              </Tooltip>

              <div className="mx-1 h-4 w-px bg-border" />
            </div>
            <div>
              {isEditingTitle ? (
                <div className="flex items-center gap-2">
                  <Input
                    ref={titleInputRef}
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    onKeyDown={handleTitleKeyDown}
                    className="h-8 w-48"
                  />
                  <Button variant="ghost" size="icon" onClick={handleSaveTitle}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={handleCancelEditTitle}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="font-medium text-primary">{currentProject.title}</h1>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleStartEditTitle}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${currentProject.engineType === 'excalidraw'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                    : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                    }`}>
                    {currentProject.engineType.toUpperCase()}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Export dropdown */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5">
                      <Download className="h-4 w-4" />
                      <span className="text-xs">导出</span>
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>导出图表</TooltipContent>
              </Tooltip>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup>
                  <DropdownMenuRadioItem className='pl-2' value="svg" onClick={() => canvasRef.current?.exportAsSvg(withBackground)}>
                    <Code className="mr-2 h-4 w-4" />
                    导出为 SVG
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem className='pl-2' value="png" onClick={() => canvasRef.current?.exportAsPng(withBackground)}>
                    <Image className="mr-2 h-4 w-4" />
                    导出为 PNG
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem className='pl-2' value="source" onClick={() => canvasRef.current?.exportAsSource()}>
                    <FileText className="mr-2 h-4 w-4" />
                    导出原文件
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={withBackground}
                  onCheckedChange={setWithBackground}
                  className="pl-2"
                >
                  包含背景色
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Copy dropdown */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5">
                      <Copy className="h-4 w-4" />
                      <span className="text-xs">复制</span>
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>复制到剪贴板</TooltipContent>
              </Tooltip>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup>
                  <DropdownMenuRadioItem className='pl-2' value="copy-png" onClick={() => {
                    canvasRef.current?.copyAsPng(withBackground)
                      .then(() => success('PNG 已复制'))
                      .catch(() => { /* Error handled in component */ })
                  }}>
                    <Image className="mr-2 h-4 w-4" />
                    复制为 PNG
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem className='pl-2' value="copy-svg" onClick={() => {
                    canvasRef.current?.copyAsSvg(withBackground)
                      .then(() => success('SVG 代码已复制'))
                      .catch(() => { /* Error handled in component */ })
                  }}>
                    <Code className="mr-2 h-4 w-4" />
                    复制为 SVG
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Paste button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePasteXml}
                  className="gap-1.5"
                >
                  <Clipboard className="h-4 w-4" />
                  <span className="text-xs">粘贴</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>从剪贴板粘贴 XML/代码并导入</TooltipContent>
            </Tooltip>

            {/* Source Code button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => canvasRef.current?.toggleSourceCode()}
                  className="gap-1.5"
                >
                  <Code className="h-4 w-4" />
                  <span className="text-xs">源码</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>查看源码</TooltipContent>
            </Tooltip>

            <div className="mx-1 h-4 w-px bg-border" />

            <Button
              variant={hasUnsavedChanges ? "default" : "ghost"}
              size="sm"
              onClick={handleSaveVersion}
              disabled={!hasUnsavedChanges}
            >
              <Save className="mr-2 h-4 w-4" />
              保存
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsVersionPanelOpen(!isVersionPanelOpen)}
            >
              <History className="mr-2 h-4 w-4" />
              历史版本
            </Button>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Chat Panel */}
          <div className={`flex-shrink-0 border-r border-border transition-all ${isChatPanelCollapsed ? 'w-10' : 'w-100'}`}>
            <div className={isChatPanelCollapsed ? 'hidden' : 'h-full'}>
              <ChatPanel onCollapse={() => setIsChatPanelCollapsed(true)} />
            </div>
            {isChatPanelCollapsed && (
              <div className="flex h-full flex-col items-center bg-surface py-2">
                <Button
                  variant="ghost"
                  size="icon"
                  title="展开对话面板"
                  onClick={() => setIsChatPanelCollapsed(false)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Center: Canvas */}
          <div className="relative flex-1">
            <CanvasArea ref={canvasRef} onReady={handleCanvasReady} />
            {/* Version Panel (floating) */}
            {isVersionPanelOpen && (
              <VersionPanel onClose={() => setIsVersionPanelOpen(false)} />
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
