import { useCallback, useImperativeHandle, useRef, useState, forwardRef, useEffect } from 'react'
import { DrawIoEmbed } from 'react-drawio'
import type { DrawIoEmbedRef, EventExport, EventSave, EventAutoSave } from 'react-drawio'
import { cn } from '@/lib/utils'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { SourceCodePanel } from '@/components/ui/SourceCodePanel'
import { useSystemTheme } from '@/hooks/useSystemTheme'

type ExportFormat = 'svg' | 'png'

interface DrawioEditorProps {
  data: string // XML string
  onChange?: (data: string) => void
  onExport?: (data: EventExport) => void
  onSave?: (data: EventSave) => void
  className?: string
  darkMode?: boolean
  ui?: 'min' | 'sketch'
}

export interface DrawioEditorRef {
  load: (xml: string) => void
  exportDiagram: (format?: 'xmlsvg' | 'png' | 'svg') => void
  exportAsSvg: () => void
  exportAsPng: () => void
  exportAsSource: () => void
  showSourceCode: () => void
  hideSourceCode: () => void
  toggleSourceCode: () => void
  getThumbnail: () => Promise<string>
}

const DRAWIO_BASE_URL = import.meta.env.VITE_DRAWIO_BASE_URL || 'https://embed.diagrams.net'

export const DrawioEditor = forwardRef<DrawioEditorRef, DrawioEditorProps>(
  function DrawioEditor({ data, onChange, onExport, className, darkMode: _darkMode = false, ui = 'min' }, ref) {
    const drawioRef = useRef<DrawIoEmbedRef | null>(null)
    const [isReady, setIsReady] = useState(false)
    const [showCodePanel, setShowCodePanel] = useState(false)
    const systemTheme = useSystemTheme()

    // 跟踪初始 XML，只在首次加载时使用
    const initialXmlRef = useRef<string>(data)
    // 跟踪当前内容，用于 SourceCodePanel 显示
    const currentContentRef = useRef<string>(data)
    // 标记是否需要从外部加载新数据（区分内部编辑和外部加载）
    const pendingExternalLoadRef = useRef<string | null>(null)

    // 使用 ref 来跟踪导出请求，避免状态更新的时序问题
    const saveResolverRef = useRef<{
      resolver: ((data: string) => void) | null
      format: ExportFormat | null
    }>({ resolver: null, format: null })

    // 用于获取缩略图的 resolver
    const thumbnailResolverRef = useRef<((data: string) => void) | null>(null)

    // Handle export event - 处理导出回调
    const handleExportCallback = useCallback((exportData: EventExport) => {
      // 如果有待处理的缩略图请求，优先处理
      if (thumbnailResolverRef.current) {
        thumbnailResolverRef.current(exportData.data)
        thumbnailResolverRef.current = null
        return
      }

      // 如果有待处理的文件保存请求，优先处理
      if (saveResolverRef.current.resolver) {
        const format = saveResolverRef.current.format
        saveResolverRef.current.resolver(exportData.data)
        saveResolverRef.current = { resolver: null, format: null }

        // 对于 png/svg 格式，处理完毕后直接返回
        if (format === 'png' || format === 'svg') {
          return
        }
      }

      // 调用外部的 onExport 回调（如果有）
      onExport?.(exportData)
    }, [onExport])

    // 保存图表到文件的核心函数
    const saveDiagramToFile = useCallback((filename: string, format: ExportFormat) => {
      if (!drawioRef.current || !isReady) {
        console.warn('Draw.io editor not ready')
        return
      }

      // 设置 resolver，在导出回调中处理
      saveResolverRef.current = {
        resolver: (exportData: string) => {
          let href: string
          let extension: string

          if (format === 'png') {
            // PNG 数据是 base64 data URL
            if (exportData.startsWith('data:')) {
              href = exportData
            } else {
              href = `data:image/png;base64,${exportData}`
            }
            extension = '.png'
          } else {
            // SVG 格式
            if (exportData.startsWith('data:')) {
              href = exportData
            } else if (exportData.startsWith('<svg') || exportData.startsWith('<?xml')) {
              // 原始 SVG 内容 - 创建 blob URL
              const blob = new Blob([exportData], { type: 'image/svg+xml' })
              href = URL.createObjectURL(blob)
            } else {
              // 假设是 base64 编码的 SVG
              href = `data:image/svg+xml;base64,${exportData}`
            }
            extension = '.svg'
          }

          // 执行下载
          const link = document.createElement('a')
          link.href = href
          link.download = `${filename}${extension}`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)

          // 延迟释放 blob URL
          if (href.startsWith('blob:')) {
            setTimeout(() => URL.revokeObjectURL(href), 100)
          }
        },
        format,
      }

      // 触发导出 - 回调会在 handleExportCallback 中处理
      drawioRef.current.exportDiagram({ format })
    }, [isReady])

    // Export as SVG
    const exportAsSvg = useCallback(() => {
      saveDiagramToFile(`diagram-${Date.now()}`, 'svg')
    }, [saveDiagramToFile])

    // Export as PNG
    const exportAsPng = useCallback(() => {
      saveDiagramToFile(`diagram-${Date.now()}`, 'png')
    }, [saveDiagramToFile])

    // Export as source (.drawio file - XML format)
    const exportAsSource = useCallback(() => {
      if (!data) return

      const blob = new Blob([data], { type: 'application/xml' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `diagram-${Date.now()}.drawio`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    }, [data])

    // Get thumbnail as PNG data URL
    const getThumbnail = useCallback((): Promise<string> => {
      return new Promise((resolve) => {
        if (!drawioRef.current || !isReady) {
          resolve('')
          return
        }

        // 设置超时，防止无限等待
        const timeout = setTimeout(() => {
          thumbnailResolverRef.current = null
          resolve('')
        }, 5000)

        thumbnailResolverRef.current = (exportData: string) => {
          clearTimeout(timeout)
          // 确保返回的是 data URL 格式
          if (exportData.startsWith('data:')) {
            resolve(exportData)
          } else {
            resolve(`data:image/png;base64,${exportData}`)
          }
        }

        // 触发 PNG 导出
        drawioRef.current.exportDiagram({ format: 'png' })
      })
    }, [isReady])

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      load: (xml: string) => {
        if (drawioRef.current) {
          drawioRef.current.load({ xml })
        }
      },
      exportDiagram: (format: 'xmlsvg' | 'png' | 'svg' = 'xmlsvg') => {
        if (drawioRef.current) {
          drawioRef.current.exportDiagram({ format })
        }
      },
      exportAsSvg,
      exportAsPng,
      exportAsSource,
      showSourceCode: () => setShowCodePanel(true),
      hideSourceCode: () => setShowCodePanel(false),
      toggleSourceCode: () => setShowCodePanel(prev => !prev),
      getThumbnail,
    }), [exportAsSvg, exportAsPng, exportAsSource, getThumbnail])

    // Handle drawio load event
    const handleLoad = useCallback(() => {
      setIsReady(true)
    }, [])

    // Handle autosave event - 自动监听数值变化
    // 只更新 ref 和通知父组件，不触发重新渲染
    const handleAutoSave = useCallback((data: EventAutoSave) => {
      if (data.xml) {
        // 更新内部跟踪的当前内容
        currentContentRef.current = data.xml
        // 通知父组件内容变化，但不会导致 xml prop 变化触发 reload
        onChange?.(data.xml)
      }
    }, [onChange])

    // Apply code changes from SourceCodePanel
    const handleApplyCode = useCallback((newCode: string) => {
      if (newCode.trim() && newCode !== currentContentRef.current) {
        // Load the new XML into draw.io
        if (drawioRef.current) {
          drawioRef.current.load({ xml: newCode })
        }
        // 更新内部跟踪
        currentContentRef.current = newCode
        // Notify parent of change
        onChange?.(newCode)
      }
    }, [onChange])

    // 监听外部 data prop 变化（如 AI 生成新图）
    // 只有当外部数据与当前内容不同时才加载
    useEffect(() => {
      // 跳过初始渲染
      if (data === initialXmlRef.current) {
        return
      }
      // 如果外部数据与当前内容相同，说明是 autosave 触发的更新，忽略
      if (data === currentContentRef.current) {
        return
      }
      // 外部数据变化，需要加载新内容
      if (isReady && drawioRef.current) {
        drawioRef.current.load({ xml: data })
        currentContentRef.current = data
      } else {
        // 如果还没准备好，标记待加载
        pendingExternalLoadRef.current = data
      }
    }, [data, isReady])

    return (
      <TooltipProvider>
        <div className={cn('relative h-full w-full', className)}>
          <DrawIoEmbed
            key={systemTheme}
            ref={drawioRef}
            xml={currentContentRef.current}
            baseUrl={DRAWIO_BASE_URL}
            onLoad={handleLoad}
            onAutoSave={handleAutoSave}
            onExport={handleExportCallback}
            autosave={true}

            configuration={{
              // 隐藏底部页面管理栏
              css: `.geFooterContainer, .geTabContainer, .geTabbedDiagram { display: none !important; }
              .geMenubarContainer { background: ${systemTheme === 'dark' ? '#27272a' : '#fff'} !important; }
              .geMenubarContainer .geItem { color: ${systemTheme === 'dark' ? '#e2e8f0' : '#000'} !important; }`
            }}
            urlParameters={{
              ui,
              dark: systemTheme === 'dark',
              spin: true,
              libraries: false,
              saveAndExit: false,
              noExitBtn: true,
              noSaveBtn: true
            }}

          />
          {!isReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80">
              <div className="text-center">
                <div className="mb-2 h-8 w-8 animate-spin rounded-full border-2 border-primary border-r-transparent mx-auto" />
                <p className="text-sm text-muted">Loading Draw.io...</p>
              </div>
            </div>
          )}

          {/* Code Panel */}
          {showCodePanel && (
            <SourceCodePanel
              code={data}
              language="xml"
              title="Draw.io XML 源码"
              onApply={handleApplyCode}
              onClose={() => setShowCodePanel(false)}
            />
          )}
        </div>
      </TooltipProvider>
    )
  }
)
