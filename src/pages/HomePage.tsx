import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Paperclip, ChevronDown, Plus, Send } from 'lucide-react'
import { Button } from '@/components/ui'
import { AppSidebar, AppHeader, CreateProjectDialog } from '@/components/layout'
import { ENGINES, QUICK_ACTIONS } from '@/constants'
import { formatDate } from '@/lib/utils'
import type { EngineType, Project } from '@/types'
import { ProjectRepository } from '@/services/projectRepository'
import { useChatStore } from '@/stores/chatStore'

export function HomePage() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [selectedEngine, setSelectedEngine] = useState<EngineType>('mermaid')
  const [isLoading, setIsLoading] = useState(false)
  const [recentProjects, setRecentProjects] = useState<Project[]>([])
  const [showEngineDropdown, setShowEngineDropdown] = useState(false)
  const [attachments, setAttachments] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const setInitialPrompt = useChatStore((state) => state.setInitialPrompt)

  // 新建项目弹窗状态
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

  useEffect(() => {
    loadRecentProjects()
  }, [])

  // 点击外部关闭引擎选择下拉框
  useEffect(() => {
    const handleClickOutside = () => setShowEngineDropdown(false)
    if (showEngineDropdown) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showEngineDropdown])

  const loadRecentProjects = async () => {
    try {
      const projects = await ProjectRepository.getAll()
      setRecentProjects(projects.slice(0, 5))
    } catch (error) {
      console.error('Failed to load projects:', error)
    }
  }

  const handleQuickStart = async () => {
    if (!prompt.trim()) return

    setIsLoading(true)
    try {
      const project = await ProjectRepository.create({
        title: `Untitled-${Date.now()}`,
        engineType: selectedEngine,
      })

      setInitialPrompt(prompt.trim())
      navigate(`/editor/${project.id}`)
    } catch (error) {
      console.error('Failed to create project:', error)
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

  return (
    <div className="flex min-h-screen bg-background">
      {/* Floating Sidebar Navigation */}
      <AppSidebar onCreateProject={() => setIsCreateDialogOpen(true)} />

      {/* Main Content */}
      <main className="flex flex-1 flex-col">
        {/* Header */}
        <AppHeader />

        {/* Hero Section */}
        <div className="flex flex-1 flex-col items-center px-8 pt-12">
          {/* Promotional Banner */}
          {/* <div className="mb-8 flex items-center gap-2 rounded-full bg-accent-light px-4 py-2">
            <span className="rounded bg-accent px-2 py-0.5 text-xs font-medium text-surface">
              NEW
            </span>
            <span className="text-sm text-primary">
              立即升级，享受365天无限制使用！
            </span>
            <span className="cursor-pointer text-sm font-medium text-accent">
              立即升级 →
            </span>
          </div> */}

          {/* Logo & Slogan */}
          <div className="mb-8 flex flex-col items-center">
            <div className="mb-4 flex items-center gap-3">
              {/* <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
                <Sparkles className="h-6 w-6 text-surface" />
              </div> */}
              <h1 className="text-3xl font-bold text-primary">
                AI Draw Nexus 让图形绘制更简单
              </h1>
            </div>
            <p className="text-muted">AI驱动的一站式绘图平台</p>
          </div>

          {/* Chat Input Box */}
          <div className="mb-6 w-full max-w-2xl">
            <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm transition-shadow focus-within:shadow-md">
              {/* 附件预览区域 */}
              {attachments.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {attachments.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5 text-sm"
                    >
                      <Paperclip className="h-3 w-3 text-muted" />
                      <span className="max-w-[150px] truncate text-primary">
                        {file.name}
                      </span>
                      <button
                        onClick={() => removeAttachment(index)}
                        className="text-muted hover:text-primary"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={textareaRef}
                placeholder="描述你想要绘制的图表，AI Draw Nexus 会帮你完成..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                className="min-h-[60px] w-full resize-none bg-transparent text-primary placeholder:text-muted focus:outline-none"
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
              <div className="flex items-center justify-between border-t border-border pt-3 mt-2">
                <div className="flex items-center gap-3">
                  {/* 上传附件 */}
                  <button
                    onClick={handleAttachmentClick}
                    className="group relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-background hover:text-primary"
                    title="可上传文档一键转化为图表，或上传截图复刻图表"
                  >
                    <Paperclip className="h-4 w-4" />
                    <span>上传附件</span>
                    <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-primary px-3 py-2 text-xs text-surface opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                      可上传文档一键转化为图表，或上传截图复刻图表
                      <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-primary"></div>
                    </div>
                  </button>

                  {/* 选择绘图引擎 */}
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowEngineDropdown(!showEngineDropdown)
                      }}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-background hover:text-primary"
                    >
                      <span>{ENGINES.find(e => e.value === selectedEngine)?.label}</span>
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {showEngineDropdown && (
                      <div
                        className="absolute bottom-full left-0 mb-2 w-64 rounded-xl border border-border bg-surface py-1 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {ENGINES.map((engine) => {
                          const descriptions: Record<string, string> = {
                            mermaid: '简洁标准的图形绘制',
                            excalidraw: '优雅干净的手绘风格',
                            drawio: '专业而强大的绘图工具',
                          }
                          return (
                            <button
                              key={engine.value}
                              onClick={() => {
                                setSelectedEngine(engine.value)
                                setShowEngineDropdown(false)
                              }}
                              className={`w-full px-4 py-2 text-left transition-colors hover:bg-background ${
                                selectedEngine === engine.value
                                  ? 'text-accent'
                                  : 'text-primary'
                              }`}
                            >
                              <div className={`text-sm ${selectedEngine === engine.value ? 'font-medium' : ''}`}>
                                {engine.label}
                              </div>
                              <div className="text-xs text-muted mt-0.5">
                                {descriptions[engine.value]}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* 发送按钮 */}
                <Button
                  onClick={handleQuickStart}
                  disabled={!prompt.trim() || isLoading}
                  className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm text-surface transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {isLoading ? (
                    <span>创建中...</span>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      <span>发送</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mb-12 w-full max-w-3xl">
            <p className="mb-4 text-center text-sm text-muted">试试这些示例，快速开始</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {QUICK_ACTIONS.map((action, index) => (
                <button
                  key={index}
                  onClick={() => handleQuickAction(action)}
                  disabled={isLoading}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-left transition-all hover:border-primary hover:shadow-md disabled:opacity-50"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-background">
                    <action.icon className="h-5 w-5 text-accent" />
                  </div>
                  <span className="text-sm text-primary line-clamp-2">{action.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Recent Projects Section */}
          <div className="w-full max-w-6xl pb-12">
            <h2 className="mb-4 text-lg font-medium text-primary">最近项目</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {/* New Project Card */}
              <button
                onClick={() => setIsCreateDialogOpen(true)}
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-surface transition-all hover:border-primary hover:shadow-md"
                style={{ height: 'calc(6rem + 68px)' }}
              >
                <Plus className="mb-2 h-6 w-6 text-muted" />
                <span className="text-sm text-muted">新建项目</span>
              </button>

              {/* Recent Projects */}
              {recentProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => navigate(`/editor/${project.id}`)}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition-all hover:border-primary hover:shadow-md"
                >
                  <div className="flex h-24 items-center justify-center bg-background">
                    {project.thumbnail ? (
                      <img
                        src={project.thumbnail}
                        alt={project.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Sparkles className="h-8 w-8 text-muted" />
                    )}
                  </div>
                  <div className="p-3 text-left">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-primary">
                        {project.title === `Untitled-${project.id}`
                          ? '未命名'
                          : project.title}
                      </p>
                      <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        project.engineType === 'excalidraw'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                          : project.engineType === 'drawio'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                      }`}>
                        {project.engineType.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-muted">
                      更新于 {formatDate(project.updatedAt)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Create Project Dialog */}
      <CreateProjectDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </div>
  )
}
