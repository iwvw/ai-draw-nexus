import { useState, useRef, useEffect, useCallback } from 'react'
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CopyIcon,
  FileTextIcon,
  ImageSquareIcon,
  LinkIcon,
  PaperPlaneRightIcon,
  RobotIcon,
  SparkleIcon,
  UserIcon,
  XIcon,
} from '@phosphor-icons/react'
import { Button, Input, Loading, Textarea } from '@/components/ui'
import { Empty, Popover } from '@cloudflare/kumo'
import { useChatStore } from '@/stores/chatStore'
import { useEditorStore, selectIsEmpty } from '@/stores/editorStore'
import { useAIGenerate } from '@/hooks/useAIGenerate'
import { useToast } from '@/hooks/useToast'
import { aiService } from '@/services/aiService'
import {
  validateImageFile,
  validateDocumentFile,
  fileToBase64,
  parseDocument,
  selectFiles,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_DOCUMENT_EXTENSIONS,
} from '@/lib/fileUtils'
import type { Attachment, ImageAttachment, DocumentAttachment, UrlAttachment } from '@/types'
import { FILE_DROP_EVENT } from '@/lib/dragEvents'

// Pretty-print drawio XML (single-line output from AI becomes indented).
function prettyXml(xml: string): string {
  const clean = xml.replace(/>\s*</g, '><').trim()
  if (!clean) return xml

  const lines: string[] = []
  let depth = 0
  let i = 0

  while (i < clean.length) {
    const tagStart = clean.indexOf('<', i)
    if (tagStart === -1) break

    const text = clean.slice(i, tagStart)
    if (text.trim()) lines.push('  '.repeat(depth) + text.trim())

    const isClose = clean[tagStart + 1] === '/'
    const isDecl = clean[tagStart + 1] === '?' || clean[tagStart + 1] === '!'
    const tagEnd = clean.indexOf('>', tagStart)
    if (tagEnd === -1) break
    const tag = clean.slice(tagStart, tagEnd + 1)
    i = tagEnd + 1

    if (isDecl) {
      lines.push('  '.repeat(depth) + tag)
      continue
    }

    if (isClose) {
      depth = Math.max(0, depth - 1)
      lines.push('  '.repeat(depth) + tag)
    } else {
      lines.push('  '.repeat(depth) + tag)
      if (!/\/\s*>$/.test(tag)) depth++
    }
  }

  return lines.join('\n')
}

export function ChatPanel() {
  const [inputValue, setInputValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isProcessingFile, setIsProcessingFile] = useState(false)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlInputValue, setUrlInputValue] = useState('')
  const [isParsingUrl, setIsParsingUrl] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasHandledInitialPrompt = useRef(false)
  const [openCodePanelByMessageId, setOpenCodePanelByMessageId] = useState<Record<string, boolean>>({})
  const assistantStatusRef = useRef<Record<string, string>>({})
  const codePanelContainerRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const { messages, isStreaming, initialPrompt, initialAttachments, clearInitialPrompt } = useChatStore()
  const isCanvasEmpty = useEditorStore(selectIsEmpty)
  const currentProject = useEditorStore((s) => s.currentProject)
  const historyLoadedForProject = useChatStore((s) => s.historyLoadedForProject)
  const { generate, retryLast } = useAIGenerate()
  const { error: showError, success: showSuccess } = useToast()

  const handleSend = useCallback(async (text?: string, initialAtts?: Attachment[]) => {
    const message = text || inputValue.trim()
    if ((!message && attachments.length === 0 && !initialAtts?.length) || isStreaming) return

    const currentAttachments = initialAtts ?? (attachments.length > 0 ? [...attachments] : undefined)
    setInputValue('')
    setAttachments([])
    await generate(message, isCanvasEmpty, currentAttachments)
  }, [attachments, generate, inputValue, isCanvasEmpty, isStreaming])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-expand assistant code panel when streaming starts; auto-collapse when streaming ends
  useEffect(() => {
    const messageIds = new Set(messages.map((m) => m.id))

    for (const id of Object.keys(assistantStatusRef.current)) {
      if (!messageIds.has(id)) delete assistantStatusRef.current[id]
    }

    setOpenCodePanelByMessageId((prev) => {
      let next: Record<string, boolean> | null = null

      for (const id of Object.keys(prev)) {
        if (!messageIds.has(id)) {
          next = next ?? { ...prev }
          delete next[id]
        }
      }

      for (const msg of messages) {
        if (msg.role !== 'assistant') continue
        const prevStatus = assistantStatusRef.current[msg.id]

        if (msg.status === 'streaming' && prevStatus !== 'streaming') {
          if ((next ?? prev)[msg.id] !== true) {
            next = next ?? { ...prev }
            next[msg.id] = true
          }
        }

        // Finished assistant messages default to collapsed so a long code
        // block never fills the panel on its own.
        if (msg.status === 'complete') {
          if ((next ?? prev)[msg.id] !== false) {
            next = next ?? { ...prev }
            next[msg.id] = false
          }
        }
      }

      return next ?? prev
    })

    for (const msg of messages) {
      if (msg.role === 'assistant') assistantStatusRef.current[msg.id] = msg.status
    }
  }, [messages])

  // Keep the streaming code panel scrolled to bottom
  useEffect(() => {
    const streamingMsg = [...messages].reverse().find((m) => m.role === 'assistant' && m.status === 'streaming')
    if (!streamingMsg) return
    if (!openCodePanelByMessageId[streamingMsg.id]) return

    const container = codePanelContainerRefs.current[streamingMsg.id]
    if (container) container.scrollTop = container.scrollHeight
  }, [messages, openCodePanelByMessageId])

  // Handle initial prompt from Quick Start (Path A)
  // Wait for the project to be loaded (currentProject) AND the chat history
  // to be applied (historyLoadedForProject) before generating: generate()
  // silently returns without a project, and loadHistory() overwrites messages,
  // which would wipe the freshly added user/assistant messages.
  useEffect(() => {
    if (
      initialPrompt &&
      !hasHandledInitialPrompt.current &&
      currentProject &&
      historyLoadedForProject === currentProject.id
    ) {
      hasHandledInitialPrompt.current = true
      const attachmentsToSend = initialAttachments ?? undefined
      clearInitialPrompt()
      handleSend(initialPrompt, attachmentsToSend)
    }
  }, [initialPrompt, initialAttachments, clearInitialPrompt, handleSend, currentProject, historyLoadedForProject])

  const handleImageUpload = async () => {
    const files = await selectFiles(SUPPORTED_IMAGE_TYPES.join(','))
    if (!files || files.length === 0) return

    setIsProcessingFile(true)
    try {
      const file = files[0]
      const validation = validateImageFile(file)
      if (!validation.valid) {
        showError(validation.error!)
        return
      }

      const dataUrl = await fileToBase64(file)
      const imageAttachment: ImageAttachment = {
        type: 'image',
        dataUrl,
        fileName: file.name,
      }
      setAttachments((prev) => [...prev, imageAttachment])
    } catch (err) {
      showError('图片处理失败')
      console.error(err)
    } finally {
      setIsProcessingFile(false)
    }
  }

  const handleDocumentUpload = async () => {
    const files = await selectFiles(SUPPORTED_DOCUMENT_EXTENSIONS.join(','))
    if (!files || files.length === 0) return

    setIsProcessingFile(true)
    try {
      const file = files[0]
      const validation = validateDocumentFile(file)
      if (!validation.valid) {
        showError(validation.error!)
        return
      }

      const content = await parseDocument(file)
      const docAttachment: DocumentAttachment = {
        type: 'document',
        content,
        fileName: file.name,
      }
      setAttachments((prev) => [...prev, docAttachment])
    } catch (err) {
      showError('文档处理失败')
      console.error(err)
    } finally {
      setIsProcessingFile(false)
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  useEffect(() => {
    const onFileDrop = async (event: Event) => {
      const file = (event as CustomEvent<File>).detail
      setIsProcessingFile(true)
      try {
        const content = await parseDocument(file)
        const docAttachment: DocumentAttachment = {
          type: 'document',
          content,
          fileName: file.name,
        }
        setAttachments((prev) => [...prev, docAttachment])
        showSuccess(`已添加文档附件「${file.name}」，输入指令后发送`)
      } catch (err) {
        showError('文档处理失败')
        console.error(err)
      } finally {
        setIsProcessingFile(false)
      }
    }
    window.addEventListener(FILE_DROP_EVENT, onFileDrop)
    return () => window.removeEventListener(FILE_DROP_EVENT, onFileDrop)
  }, [showSuccess, showError])

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
        setAttachments((prev) => [...prev, urlAttachment])
        setUrlInputValue('')
        setShowUrlInput(false)
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : '链接解析失败')
      console.error(err)
    } finally {
      setIsParsingUrl(false)
    }
  }

  const handleCopyUserMessage = async (text: string) => {
    const toCopy = text?.trim()
    if (!toCopy) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(toCopy)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = toCopy
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      showSuccess('已复制')
    } catch (err) {
      showError('复制失败')
      console.error(err)
    }
  }

  const lastAssistantMessageId = [...messages].reverse().find((m) => m.role === 'assistant')?.id

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
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
    setIsProcessingFile(true)

    try {
      for (const file of filesToProcess) {
        // 处理图片
        if (SUPPORTED_IMAGE_TYPES.includes(file.type)) {
          const validation = validateImageFile(file)
          if (!validation.valid) {
            showError(validation.error!)
            continue
          }
          const dataUrl = await fileToBase64(file)
          const imageAttachment: ImageAttachment = {
            type: 'image',
            dataUrl,
            fileName: file.name || `粘贴图片-${Date.now()}.png`,
          }
          setAttachments((prev) => [...prev, imageAttachment])
        }
        // 处理文档
        else if (SUPPORTED_DOCUMENT_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext.replace('*', '')))) {
          const validation = validateDocumentFile(file)
          if (!validation.valid) {
            showError(validation.error!)
            continue
          }
          const content = await parseDocument(file)
          const docAttachment: DocumentAttachment = {
            type: 'document',
            content,
            fileName: file.name,
          }
          setAttachments((prev) => [...prev, docAttachment])
        }
      }
    } catch (err) {
      showError('粘贴文件处理失败')
      console.error(err)
    } finally {
      setIsProcessingFile(false)
    }
  }

  // 获取AI消息的状态显示
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'pending':
        return { text: '等待中...', icon: <Loading size="sm" /> }
      case 'streaming':
        return { text: '绘制中...', icon: <Loading size="sm" /> }
      case 'complete':
        return { text: '绘制完成', icon: <CheckCircleIcon className="h-4 w-4 text-kumo-success" /> }
      case 'error':
        return { text: '出错了', icon: <XIcon className="h-4 w-4 text-kumo-danger" /> }
      default:
        return { text: '处理中...', icon: <Loading size="sm" /> }
    }
  }

  const getAssistantCodeText = (raw: string) => {
    if (!raw) return ''
    const sep = '\n\n'
    const idx = raw.indexOf(sep)
    return idx === -1 ? raw : raw.slice(idx + sep.length)
  }

  const formatDiagramCode = (raw: string, engine: string | undefined) => {
    if (!raw) return raw
    if (engine === 'excalidraw') {
      try {
        return JSON.stringify(JSON.parse(raw), null, 2)
      } catch {
        return raw
      }
    }
    if (engine === 'drawio') {
      return prettyXml(raw)
    }
    return raw
  }

  const getAssistantSummary = (raw: string) => {
    if (!raw) return ''
    const sep = '\n\n'
    const idx = raw.indexOf(sep)
    const summary = idx === -1 ? raw : raw.slice(0, idx)
    return summary.length > 160 ? `${summary.slice(0, 160)}…` : summary
  }

  const toggleCodePanel = (messageId: string) => {
    setOpenCodePanelByMessageId((prev) => ({ ...prev, [messageId]: !prev[messageId] }))
  }

  return (
      <div className="flex h-full flex-col bg-kumo-base text-kumo-default">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <Empty
            icon={
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-kumo-brand/10">
                <SparkleIcon className="h-7 w-7 text-kumo-brand" />
              </div>
            }
            title="描述你的需求"
            description="支持图片、文档与网址链接，基于当前图表生成或修改"
            className="h-full px-2"
          />
        ) : (
          messages.map((msg) => {
            const isAssistant = msg.role === 'assistant'
            const isCodePanelOpen = isAssistant ? (openCodePanelByMessageId[msg.id] ?? false) : false
            const assistantCodeText = isAssistant
              ? formatDiagramCode(getAssistantCodeText(msg.content), currentProject?.engineType)
              : ''

            return (
              <div
                key={msg.id}
                className={`group mb-4 flex max-w-full items-start gap-2.5 ${
                  msg.role === 'user' ? 'flex-row-reverse' : ''
                }`}
              >
                {/* Avatar */}
                <div
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-kumo-brand/10 text-kumo-brand'
                      : 'border border-kumo-line bg-kumo-elevated text-kumo-subtle'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <UserIcon className="h-3.5 w-3.5" />
                  ) : (
                    <RobotIcon className="h-3.5 w-3.5" />
                  )}
                </div>

                {/* Content */}
                <div className={`flex min-w-0 flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {msg.role === 'user' ? (
                    <div className="max-w-full rounded-xl rounded-br-sm bg-kumo-brand px-3.5 py-2 text-sm text-kumo-inverse shadow-xs">
                      {/* Show attachments for user messages */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {msg.attachments.map((att, idx) => (
                            <div key={idx} className="text-xs opacity-80">
                              {att.type === 'image' ? (
                                <img
                                  src={att.dataUrl}
                                  alt={att.fileName}
                                  className="max-h-20 max-w-20 rounded-md border border-kumo-inverse/30 object-cover"
                                />
                              ) : att.type === 'url' ? (
                                <span className="flex items-center gap-1">
                                  <LinkIcon className="h-3 w-3" />
                                  {att.title}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <FileTextIcon className="h-3 w-3" />
                                  {att.fileName}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-sm break-words whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  ) : (
                    <div className="w-full min-w-0 rounded-xl rounded-tl-sm border border-kumo-line bg-kumo-elevated shadow-xs">
                      {/* Status bar */}
                      <div className="flex items-center justify-between gap-2 border-b border-kumo-line/60 px-3 py-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-kumo-subtle">
                          {getStatusDisplay(msg.status).icon}
                          <span>{getStatusDisplay(msg.status).text}</span>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          shape="square"
                          title={isCodePanelOpen ? '折叠代码' : '展开代码'}
                          onClick={() => toggleCodePanel(msg.id)}
                        >
                          {isCodePanelOpen ? (
                            <CaretDownIcon className="h-3.5 w-3.5" />
                          ) : (
                            <CaretRightIcon className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                      {!isCodePanelOpen && msg.status === 'complete' && (
                        <p className="px-3 py-2.5 text-sm break-words whitespace-pre-wrap">{getAssistantSummary(msg.content)}</p>
                      )}
                      {isCodePanelOpen && (
                        <div
                          ref={(el) => { codePanelContainerRefs.current[msg.id] = el }}
                          className="max-h-56 overflow-auto border-t border-kumo-line/60 bg-kumo-recessed p-3"
                        >
                          <pre className="max-w-full overflow-x-auto text-xs font-mono whitespace-pre">{assistantCodeText || '...'}</pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action buttons (hover reveal) */}
                  {msg.role === 'user' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      shape="square"
                      title="复制"
                      onClick={() => handleCopyUserMessage(msg.content)}
                      disabled={!msg.content?.trim()}
                      className="self-end opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <CopyIcon className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    msg.id === lastAssistantMessageId && (
                      <Button
                        variant="secondary"
                        size="sm"
                        shape="square"
                        title="重新发送"
                        onClick={() => retryLast(msg.id)}
                        disabled={isStreaming || msg.status === 'streaming' || msg.status === 'pending'}
                        className="self-start opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <ArrowClockwiseIcon className="h-3.5 w-3.5" />
                      </Button>
                    )
                  )}
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Attachment Preview */}
      {attachments.length > 0 && (
        <div className="border-t border-kumo-line px-3 py-2.5">
          <div className="flex flex-wrap gap-2">
            {attachments.map((att, idx) => (
              <div
                key={idx}
                className="relative flex items-center gap-1.5 rounded-lg border border-kumo-line bg-kumo-elevated px-2 py-1 text-xs shadow-xs"
              >
                {att.type === 'image' ? (
                  <img
                    src={att.dataUrl}
                    alt={att.fileName}
                    className="h-7 w-7 rounded-md object-cover"
                  />
                ) : att.type === 'url' ? (
                  <>
                    <LinkIcon className="h-3.5 w-3.5 text-kumo-link" />
                    <span className="max-w-24 truncate">{att.title}</span>
                  </>
                ) : (
                  <>
                    <FileTextIcon className="h-3.5 w-3.5 text-kumo-link" />
                    <span className="max-w-24 truncate">{att.fileName}</span>
                  </>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  shape="square"
                  title="移除附件"
                  onClick={() => removeAttachment(idx)}
                  className="ml-0.5 text-kumo-subtle hover:text-kumo-danger"
                >
                  <XIcon className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-kumo-line p-3">
        <div className="relative flex flex-col rounded-xl border border-kumo-line bg-kumo-elevated shadow-xs transition-colors focus-within:border-kumo-brand focus-within:ring-2 focus-within:ring-kumo-brand/10">
          {/* Textarea */}
          <Textarea
            ref={textareaRef}
            placeholder="输入你的消息...（支持粘贴图片）"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={isStreaming}
            autoResize
            minRows={2}
            maxRows={8}
            className="w-full resize-none bg-transparent px-3.5 pt-3 pb-12 text-sm text-kumo-default outline-none placeholder:text-kumo-subtle disabled:opacity-50 !ring-0 focus:!ring-0"
          />

          {/* Bottom toolbar inside input */}
          <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                shape="square"
                title="上传图片"
                onClick={handleImageUpload}
                disabled={isStreaming || isProcessingFile}
              >
                <ImageSquareIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                shape="square"
                title="上传文档 (docx, txt, md)"
                onClick={handleDocumentUpload}
                disabled={isStreaming || isProcessingFile}
              >
                <FileTextIcon className="h-4 w-4" />
              </Button>
              <Popover open={showUrlInput} onOpenChange={setShowUrlInput}>
                <Popover.Trigger
                  render={(props) => (
                    <Button
                      {...props}
                      variant="secondary"
                      size="sm"
                      shape="square"
                      title="添加网址链接"
                      disabled={isStreaming || isProcessingFile || isParsingUrl}
                    >
                      <LinkIcon className="h-4 w-4" />
                    </Button>
                  )}
                />
                <Popover.Content
                  side="top"
                  align="start"
                  sideOffset={8}
                  className="grid w-[min(20rem,calc(100vw-3rem))] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl border border-kumo-line bg-kumo-elevated p-2 shadow-md"
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
                    <ArrowRightIcon className="h-4 w-4" />
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
              {isProcessingFile && (
                <span className="ml-1.5 flex items-center text-xs text-kumo-subtle">
                  <Loading size="sm" className="mr-1" />
                  处理中...
                </span>
              )}
              {isParsingUrl && (
                <span className="ml-1.5 flex items-center text-xs text-kumo-subtle">
                  <Loading size="sm" className="mr-1" />
                  解析链接中...
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] text-kumo-subtle">Enter 发送 · Shift + Enter 换行</p>
              <Button
                onClick={() => handleSend()}
                disabled={(!inputValue.trim() && attachments.length === 0) || isStreaming}
                size="sm"
                shape="square"
                title="发送"
              >
                <PaperPlaneRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
