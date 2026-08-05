import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLineLeftIcon,
  ArrowLineRightIcon,
  ChatCircleDotsIcon,
  CheckIcon,
  ClipboardTextIcon,
  CodeIcon,
  CopyIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  HouseIcon,
  ImageIcon,
  PencilSimpleIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react'
import { Button, Input, Loading } from '@/components/ui'
import { ChatPanel } from '@/features/chat/ChatPanel'
import { CanvasArea, type CanvasAreaRef } from '@/features/editor/CanvasArea'
import { VersionMenu } from '@/features/editor/VersionMenu'
import { useEditorStore } from '@/stores/editorStore'
import { useChatStore } from '@/stores/chatStore'
import { SettingsService } from '@/services/settingsService'
import { ProjectService } from '@/services/projectService'
import { VersionService } from '@/services/versionService'
import { generateThumbnail } from '@/lib/thumbnail'
import { useToast } from '@/hooks/useToast'
import { useCollab } from '@/hooks/useCollab'
import { validateContent } from '@/lib/validators'
import { Badge, DropdownMenu, Tooltip, TooltipProvider } from '@cloudflare/kumo'
import { engineBadgeVariant } from '@/constants'

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [isChatPanelCollapsed, setIsChatPanelCollapsed] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<CanvasAreaRef>(null)
  const isRemoteChange = useRef(false)
  const collabDebounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveDebounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [withBackground, setWithBackground] = useState(true)
  const { success, error: showError } = useToast()

  const { currentProject, currentContent, hasUnsavedChanges, setProject, setContent, setContentFromVersion, markAsSaved, reset: resetEditor } = useEditorStore()
  const { currentProjectId, loadHistory, messages, isStreaming, clearMessages } = useChatStore()

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

  // Regenerate and persist the project thumbnail from the current content.
  // Returns true when a thumbnail was successfully saved.
  const updateThumbnail = useCallback(async (): Promise<boolean> => {
    if (!currentProject || !currentContent) return false

    try {
      let thumbnail = ''
      if (currentProject.engineType === 'drawio' && canvasRef.current) {
        thumbnail = await canvasRef.current.getThumbnail()
      } else {
        thumbnail = await generateThumbnail(currentContent, currentProject.engineType)
      }

      if (!thumbnail) return false

      await ProjectService.update(currentProject.id, { thumbnail })
      setProject({ ...currentProject, thumbnail })
      return true
    } catch (err) {
      console.error('Thumbnail update failed:', err)
      return false
    }
  }, [currentProject, currentContent, setProject])

  useEffect(() => {
    SettingsService.getUiPreferences().then((prefs) => {
      if (prefs.chatPanelCollapsed !== undefined) {
        setIsChatPanelCollapsed(prefs.chatPanelCollapsed)
      }
    }).catch((err) => console.error('Failed to load UI preferences:', err))
  }, [])

  useEffect(() => {
    SettingsService.saveUiPreferences({ chatPanelCollapsed: isChatPanelCollapsed }).catch(
      (err) => console.error('Failed to save UI preferences:', err),
    )
  }, [isChatPanelCollapsed])

  const loadProject = useCallback(async (id: string) => {
    // Clear previous project data before loading new one.
    // While currentProject is empty, the page shows the loading state.
    resetEditor()

    try {
      const project = await ProjectService.getById(id)
      if (!project) {
        navigate('/projects')
        return
      }

      setProject(project)
      setEditedTitle(project.title)

      // Load latest version content
      const latestVersion = await VersionService.getLatest(id)
      if (latestVersion) {
        setContentFromVersion(latestVersion.content)
      }

      // Load this project's conversation from the server
      if (id !== currentProjectId) {
        await loadHistory(id)
      }
    } catch (error) {
      console.error('Failed to load project:', error)
      navigate('/projects')
    }
  }, [currentProjectId, loadHistory, navigate, resetEditor, setContentFromVersion, setProject])

  // Load project on mount.
  // React StrictMode double-invokes effects in dev, which would otherwise
  // launch two parallel loadHistory() calls; the later one overwrites the
  // freshly added chat messages. Guard by projectId.
  const loadedProjectIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!projectId) {
      navigate('/projects')
      return
    }

    if (loadedProjectIdRef.current === projectId) return
    loadedProjectIdRef.current = projectId

    loadProject(projectId)
  }, [projectId, navigate, loadProject])

  // Dirty-data guard: warn user before closing tab with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        // Attempt a synchronous last-ditch save via sendBeacon.
        // The session cookie is attached automatically (httpOnly, same-origin).
        if (currentProject && currentContent) {
          navigator.sendBeacon('/api/versions', JSON.stringify({
            project_id: currentProject.id,
            content: currentContent,
            change_summary: '自动保存 (页面关闭)'
          }))
        }
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges, currentProject, currentContent])

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

    // 2. Debounce for Auto-save to Database (2000ms).
    //    The thumbnail is regenerated on every save so the preview stays in sync.
    if (autoSaveDebounceTimeout.current) {
      clearTimeout(autoSaveDebounceTimeout.current)
    }
    autoSaveDebounceTimeout.current = setTimeout(async () => {
      try {
        await VersionService.updateLatest(currentProject.id, currentContent)
        await updateThumbnail()
        markAsSaved()
        console.log('Auto-saved content to database')
      } catch (err) {
        console.error('Auto-save failed:', err)
      }
    }, 2000)

    return () => {
      if (collabDebounceTimeout.current) clearTimeout(collabDebounceTimeout.current)
      if (autoSaveDebounceTimeout.current) clearTimeout(autoSaveDebounceTimeout.current)
    }
  }, [currentContent, hasUnsavedChanges, currentProject, sendMessage, markAsSaved, setProject, updateThumbnail])

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
      await ProjectService.update(currentProject.id, { title: editedTitle.trim() })
      setProject({ ...currentProject, title: editedTitle.trim() })
      setIsEditingTitle(false)
      success('标题已更新')
    } catch (error) {
      console.error('Failed to update title:', error)
      showError('标题更新失败')
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
        setContent(text)
        success('内容已从剪贴板导入')
      } else {
        // Fallback for drawio: sometimes users paste partial XML or variants
        if (engineType === 'drawio' && (text.includes('<mxGraphModel') || text.includes('<mxfile') || text.includes('<diagram'))) {
          setContent(text)
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
      await VersionService.create({
        projectId: currentProject.id,
        content: currentContent,
        changeSummary: '人工调整',
      })
      markAsSaved()

      // Update thumbnail for all engines
      await updateThumbnail()

      success('版本已保存')
    } catch (error) {
      console.error('Failed to save version:', error)
      showError('版本保存失败')
    }
  }

  const handleToggleSourceCode = () => {
    canvasRef.current?.toggleSourceCode()
  }

  // Generate thumbnail when canvas is ready (for projects without thumbnail, e.g., imported projects)
  const handleCanvasReady = async () => {
    if (!currentProject || !currentContent) return
    // Skip if project already has a thumbnail
    if (currentProject.thumbnail) return

    await updateThumbnail()
  }

  if (!currentProject) {
    return (
      <div className="flex h-dvh items-center justify-center bg-kumo-canvas">
        <Loading size="lg" />
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-dvh overflow-hidden flex-col bg-kumo-canvas text-kumo-default">
        {/* Toolbar */}
        <header className="flex shrink-0 flex-col gap-2 border-b border-kumo-line bg-kumo-base px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex w-full min-w-0 items-center justify-between gap-3 sm:w-auto sm:flex-1 sm:justify-start sm:gap-4">
            <div className="mr-2 flex shrink-0 items-center gap-1">
              <Tooltip content="首页" render={(props) => (
                <Button {...props} variant="secondary" size="sm" shape="square" onClick={handleGoHome}>
                  <HouseIcon className="h-4 w-4" />
                </Button>
              )} />

              <Tooltip content="项目管理" render={(props) => (
                <Button {...props} variant="secondary" size="sm" shape="square" onClick={handleProjectManagement}>
                  <FolderOpenIcon className="h-4 w-4" />
                </Button>
              )} />

              <Tooltip content="新建项目" render={(props) => (
                <Button {...props} variant="secondary" size="sm" shape="square" onClick={handleNewProject}>
                  <PlusIcon className="h-4 w-4" />
                </Button>
              )} />

              <div className="mx-1 h-4 w-px bg-kumo-line" />
            </div>
            <div className="min-w-0">
              {isEditingTitle ? (
                <div className="flex items-center gap-2">
                  <Input
                    ref={titleInputRef}
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    onKeyDown={handleTitleKeyDown}
                    size="sm"
                    className="w-48"
                  />
                  <Button variant="secondary" size="sm" shape="square" onClick={handleSaveTitle}>
                    <CheckIcon className="h-4 w-4" />
                  </Button>
                  <Button variant="secondary" size="sm" shape="square" onClick={handleCancelEditTitle}>
                    <XIcon className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate font-medium text-kumo-strong">{currentProject.title}</h1>
                  <Button
                    variant="secondary"
                    size="sm"
                    shape="square"
                    onClick={handleStartEditTitle}
                  >
                    <PencilSimpleIcon className="h-3 w-3" />
                  </Button>
                  <Badge variant={engineBadgeVariant(currentProject.engineType)}>
                    {currentProject.engineType.toUpperCase()}
                  </Badge>
                </div>
              )}
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto sm:flex-nowrap sm:gap-2">
            {/* Export dropdown */}
            <DropdownMenu>
              <Tooltip
                content="导出图表"
                render={(props) => (
                  <DropdownMenu.Trigger
                    render={(triggerProps: React.HTMLAttributes<HTMLButtonElement>) => (
                      <Button {...props} {...triggerProps} variant="secondary" size="sm">
                        <DownloadSimpleIcon className="h-4 w-4" />
                        <span className="hidden text-xs sm:inline">导出</span>
                      </Button>
                    )}
                  />
                )}
              />
              <DropdownMenu.Content>
                <DropdownMenu.RadioGroup>
                  <DropdownMenu.RadioItem value="svg" onClick={() => canvasRef.current?.exportAsSvg(withBackground)}>
                    <CodeIcon className="mr-2 h-4 w-4" />
                    导出为 SVG
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="png" onClick={() => canvasRef.current?.exportAsPng(withBackground)}>
                    <ImageIcon className="mr-2 h-4 w-4" />
                    导出为 PNG
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="source" onClick={() => canvasRef.current?.exportAsSource()}>
                    <FileTextIcon className="mr-2 h-4 w-4" />
                    导出原文件
                  </DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
                <DropdownMenu.Separator />
                <DropdownMenu.CheckboxItem
                  checked={withBackground}
                  onCheckedChange={setWithBackground}
                >
                  包含背景色
                </DropdownMenu.CheckboxItem>
              </DropdownMenu.Content>
            </DropdownMenu>

            {/* Copy dropdown */}
            <DropdownMenu>
              <Tooltip
                content="复制到剪贴板"
                render={(props) => (
                  <DropdownMenu.Trigger
                    render={(triggerProps: React.HTMLAttributes<HTMLButtonElement>) => (
                      <Button {...props} {...triggerProps} variant="secondary" size="sm">
                        <CopyIcon className="h-4 w-4" />
                        <span className="hidden text-xs sm:inline">复制</span>
                      </Button>
                    )}
                  />
                )}
              />
              <DropdownMenu.Content>
                <DropdownMenu.RadioGroup>
                  <DropdownMenu.RadioItem value="copy-png" onClick={() => {
                    canvasRef.current?.copyAsPng(withBackground)
                      .then(() => success('PNG 已复制'))
                      .catch(() => { /* Error handled in component */ })
                  }}>
                    <ImageIcon className="mr-2 h-4 w-4" />
                    复制为 PNG
                  </DropdownMenu.RadioItem>
                  <DropdownMenu.RadioItem value="copy-svg" onClick={() => {
                    canvasRef.current?.copyAsSvg(withBackground)
                      .then(() => success('SVG 代码已复制'))
                      .catch(() => { /* Error handled in component */ })
                  }}>
                    <CodeIcon className="mr-2 h-4 w-4" />
                    复制为 SVG
                  </DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu>

            {/* Paste button */}
            <Tooltip
              content="从剪贴板粘贴 XML/代码并导入"
              render={(props) => (
                <Button
                  {...props}
                  variant="secondary"
                  size="sm"
                  onClick={handlePasteXml}
                >
                  <ClipboardTextIcon className="h-4 w-4" />
                  <span className="hidden text-xs sm:inline">粘贴</span>
                </Button>
              )}
            />

            {/* Source Code button */}
            <Tooltip
              content="查看源码"
              render={(props) => (
                <Button
                  {...props}
                  variant="secondary"
                  size="sm"
                  onClick={handleToggleSourceCode}
                >
                  <CodeIcon className="h-4 w-4" />
                  <span className="hidden text-xs sm:inline">源码</span>
                </Button>
              )}
            />

            <div className="mx-1 h-4 w-px bg-kumo-line" />

            <Button
              variant={hasUnsavedChanges ? "primary" : "secondary"}
              size="sm"
              onClick={handleSaveVersion}
              disabled={!hasUnsavedChanges}
            >
              <FloppyDiskIcon className="h-4 w-4" />
              <span className="hidden sm:inline">保存</span>
            </Button>
            {/* Version history dropdown */}
            <VersionMenu />

            <div className="mx-1 h-4 w-px bg-kumo-line" />

            {/* New conversation */}
            <Tooltip
              content="新建对话"
              render={(props) => (
                <Button
                  {...props}
                  variant="secondary"
                  size="sm"
                  shape="square"
                  onClick={clearMessages}
                  disabled={isStreaming || messages.length === 0}
                >
                  <ChatCircleDotsIcon className="h-4 w-4" />
                </Button>
              )}
            />

            {/* Toggle AI chat panel (rightmost) */}
            <Tooltip
              content={isChatPanelCollapsed ? '展开对话面板' : '收起对话面板'}
              render={(props) => (
                <Button
                  {...props}
                  variant="secondary"
                  size="sm"
                  shape="square"
                  onClick={() => setIsChatPanelCollapsed((prev) => !prev)}
                  disabled={isStreaming}
                >
                  {isChatPanelCollapsed ? (
                    <ArrowLineLeftIcon className="h-4 w-4" />
                  ) : (
                    <ArrowLineRightIcon className="h-4 w-4" />
                  )}
                </Button>
              )}
            />
          </div>
        </header>

        {/* Main Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Center: Canvas */}
          <div className="relative min-h-0 flex-1">
            <CanvasArea ref={canvasRef} onReady={handleCanvasReady} />
          </div>

          {/* Right: Chat Panel */}
          <div className={`shrink-0 border-kumo-line transition-all ${
            isChatPanelCollapsed
              ? 'h-0 w-0 overflow-hidden'
              : 'h-72 w-full lg:h-auto lg:w-[25rem] lg:border-l'
          }`}>
            <ChatPanel />
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
