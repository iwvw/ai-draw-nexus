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
  ui?: 'atlas' | 'kennedy' | 'min' | 'sketch'
}

export interface DrawioEditorRef {
  load: (xml: string) => void
  exportDiagram: (format?: 'xmlsvg' | 'png' | 'svg') => void
  exportAsSvg: (withBackground?: boolean) => void
  exportAsPng: (withBackground?: boolean) => void
  copyAsPng: (withBackground?: boolean) => Promise<void>
  copyAsSvg: (withBackground?: boolean) => Promise<void>
  exportAsSource: () => void
  showSourceCode: () => void
  hideSourceCode: () => void
  toggleSourceCode: () => void
  getThumbnail: () => Promise<string>
}

const DRAWIO_BASE_URL = import.meta.env.VITE_DRAWIO_BASE_URL || 'https://embed.diagrams.net'

export const DrawioEditor = forwardRef<DrawioEditorRef, DrawioEditorProps>(
  function DrawioEditor({ data, onChange, onExport, className, darkMode: _darkMode = false, ui = 'atlas' }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const drawioRef = useRef<DrawIoEmbedRef | null>(null)
    const [isReady, setIsReady] = useState(false)
    const [showCodePanel, setShowCodePanel] = useState(false)
    const systemTheme = useSystemTheme()

    // 辅助函数：强制在 XML 中关闭网格和页面视图
    const disableGridAndPage = (xml: string): string => {
      if (!xml) return xml
      // 尝试替换 mxGraphModel 中的属性
      // 如果存在 grid="1"，替换为 grid="0"
      // 如果存在 page="1"，替换为 page="0"
      let newXml = xml.replace(/grid="1"/g, 'grid="0"').replace(/page="1"/g, 'page="0"')

      // 如果没有找到 grid 属性（默认可能开启），可以尝试注入（比较复杂，暂时只处理替换）
      return newXml
    }

    // 跟踪初始 XML，只在首次加载时使用
    const initialXmlRef = useRef<string>(disableGridAndPage(data))
    // 跟踪当前内容，用于区分外部和内部的数据变化
    const currentContentRef = useRef<string>(disableGridAndPage(data))
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
    const saveDiagramToFile = useCallback((filename: string, format: ExportFormat, withBackground: boolean = true) => {
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
      drawioRef.current.exportDiagram({
        format,
        background: withBackground ? (format === 'png' ? '#ffffff' : 'none') : 'none',
        border: '20', // Add some border for better look
        scale: format === 'png' ? '3' : '1' // Increase scale for PNG for better quality
      })
    }, [isReady])

    // Export as SVG
    const exportAsSvg = useCallback((withBackground: boolean = true) => {
      saveDiagramToFile(`diagram-${Date.now()}`, 'svg', withBackground)
    }, [saveDiagramToFile])

    // Export as PNG
    const exportAsPng = useCallback((withBackground: boolean = true) => {
      saveDiagramToFile(`diagram-${Date.now()}`, 'png', withBackground)
    }, [saveDiagramToFile])

    // Copy as PNG to clipboard
    const copyAsPng = useCallback((withBackground: boolean = true) => {
      return new Promise<void>((resolve, reject) => {
        if (!drawioRef.current || !isReady) {
          reject('Draw.io editor not ready')
          return
        }

        // Set resolver for export callback
        saveResolverRef.current = {
          resolver: async (exportData: string) => {
            try {
              let blob: Blob
              if (exportData.startsWith('data:')) {
                const res = await fetch(exportData)
                blob = await res.blob()
              } else {
                const res = await fetch(`data:image/png;base64,${exportData}`)
                blob = await res.blob()
              }

              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
              ])
              resolve()
            } catch (err) {
              console.error('Failed to copy to clipboard:', err)
              reject(err)
            }
          },
          format: 'png',
        }

        drawioRef.current?.exportDiagram({
          format: 'png',
          background: withBackground ? '#ffffff' : 'none',
          border: '20',
          scale: 3 // Increase scale for copy as PNG
        })
      })
    }, [isReady])

    // Copy as SVG to clipboard
    const copyAsSvg = useCallback((withBackground: boolean = true) => {
      return new Promise<void>((resolve, reject) => {
        if (!drawioRef.current || !isReady) {
          reject('Draw.io editor not ready')
          return
        }

        saveResolverRef.current = {
          resolver: async (exportData: string) => {
            try {
              let svgContent: string
              if (exportData.startsWith('data:image/svg+xml;base64,')) {
                svgContent = atob(exportData.split(',')[1])
              } else if (exportData.startsWith('data:')) {
                // Assume url encoded
                const content = exportData.split(',')[1]
                svgContent = decodeURIComponent(content)
              } else {
                svgContent = exportData
              }

              await navigator.clipboard.writeText(svgContent)
              resolve()
            } catch (err) {
              console.error('Failed to copy to clipboard:', err)
              reject(err)
            }
          },
          format: 'svg',
        }

        drawioRef.current?.exportDiagram({ format: 'svg', background: withBackground ? 'none' : 'none' })
      })
    }, [isReady])

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
        drawioRef.current.exportDiagram({
          format: 'png',
          width: '400',
          height: '300',
          background: '#ffffff',
        })
      })
    }, [isReady])

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      load: (xml: string) => {
        if (drawioRef.current) {
          const processedXml = disableGridAndPage(xml)
          drawioRef.current.load({ xml: processedXml })
        }
      },
      exportDiagram: (format: 'xmlsvg' | 'png' | 'svg' = 'xmlsvg') => {
        if (drawioRef.current) {
          drawioRef.current.exportDiagram({ format })
        }
      },
      exportAsSvg,
      exportAsPng,
      copyAsPng,
      copyAsSvg,
      exportAsSource,
      showSourceCode: () => setShowCodePanel(true),
      hideSourceCode: () => setShowCodePanel(false),
      toggleSourceCode: () => setShowCodePanel(prev => !prev),
      getThumbnail,
    }), [exportAsSvg, exportAsPng, copyAsPng, copyAsSvg, exportAsSource, getThumbnail])

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
        const processedCode = disableGridAndPage(newCode)
        if (drawioRef.current) {
          drawioRef.current.load({ xml: processedCode })
        }
        // 更新内部跟踪
        currentContentRef.current = processedCode
        // Notify parent of change
        onChange?.(processedCode)
      }
    }, [onChange])

    // 监听外部 data prop 变化（如 AI 生成新图、切换项目等外部导致的变动）
    // 只有当外部数据与当前内容不同时才加载，且避免频繁重加载导致撤销栈（Undo History）清空
    useEffect(() => {
      // 外部传进来的如果和本地刚刚发出去的不一样，才认为是真正的“外部新数据”
      if (data && data !== currentContentRef.current) {
        // 如果数据真的变化了（与内部缓存不一样），则强制更新内部缓存
        const processedData = disableGridAndPage(data)
        currentContentRef.current = processedData

        if (isReady && drawioRef.current) {
          drawioRef.current.load({ xml: processedData })
        } else {
          pendingExternalLoadRef.current = processedData
        }
      }
    }, [data, isReady])

    // 强制把焦点还给 iframe 的辅助方法，解决外层 React 组件拦截导致的快捷键静默失效
    const handleFocusIframe = useCallback(() => {
      if (containerRef.current) {
        const iframe = containerRef.current.querySelector('iframe')
        if (iframe && document.activeElement !== iframe) {
          // 在不引发滚动的前提下尝试将系统焦点递交给 iframe
          iframe.focus({ preventScroll: true })
        }
      }
    }, [])

    // 主动监听外层快捷键，并通过 postMessage 将 action 发送给 iframe
    useEffect(() => {
      if (!isReady) return

      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        // 如果焦点在输入框内外层处理
        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
          return
        }

        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
        const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey
        let action = ''

        if (cmdOrCtrl) {
          switch (e.key.toLowerCase()) {
            case 'c': action = 'copy'; break;
            case 'v': action = 'paste'; break;
            case 'x': action = 'cut'; break;
            case 'z': action = e.shiftKey ? 'redo' : 'undo'; break;
            case 'y': action = 'redo'; break;
            case 'a': action = 'selectAll'; break;
            case 's': action = 'save'; break;
            case 'delete':
            case 'backspace': action = 'delete'; break;
          }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          action = 'delete'
        }

        if (action && containerRef.current) {
          const iframe = containerRef.current.querySelector('iframe')
          if (iframe && iframe.contentWindow) {
            e.preventDefault()
            iframe.contentWindow.postMessage(JSON.stringify({ action }), '*')
          }
        }
      }

      window.addEventListener('keydown', handleGlobalKeyDown)
      return () => {
        window.removeEventListener('keydown', handleGlobalKeyDown)
      }
    }, [isReady])

    return (
      <TooltipProvider>
        <div
          ref={containerRef}
          className={cn('relative h-full w-full', className)}
          onMouseEnter={handleFocusIframe}
          onClick={handleFocusIframe}
        >
          <DrawIoEmbed
            ref={drawioRef}
            // 首次挂载传入初始的 xml，不要传入会频繁变动的 currentContentRef.current，
            // 否则会触发 react-drawio 内部逻辑导致全组件重载，Undo History 丢失
            xml={initialXmlRef.current}
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
              noSaveBtn: true,
              modified: false, // 防止初始化时显示不必要的修改标志
              // @ts-ignore
              math: 1,
              // @ts-ignore
              grid: 0,
              // @ts-ignore
              page: 0
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
