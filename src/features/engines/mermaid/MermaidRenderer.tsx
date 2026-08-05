import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import mermaid from 'mermaid'
import elkLayouts from '@mermaid-js/layout-elk'
import tidyTreeLayouts from '@mermaid-js/layout-tidy-tree'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { useEditorStore } from '@/stores/editorStore'
import { Tooltip, TooltipProvider, DropdownMenu } from '@cloudflare/kumo'
import {
  ArrowClockwiseIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  GitBranchIcon,
  GridFourIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  NetworkIcon,
  type Icon,
} from '@phosphor-icons/react'
import { SourceCodePanel } from '@/components/ui/SourceCodePanel'
import { useSystemTheme } from '@/hooks/useSystemTheme'

interface MermaidRendererProps {
  code: string
  className?: string
}

export interface MermaidRendererRef {
  exportAsSvg: (withBackground?: boolean) => void
  exportAsPng: (withBackground?: boolean) => void
  copyAsPng: (withBackground?: boolean) => Promise<void>
  exportAsSource: () => void
  showSourceCode: () => void
  hideSourceCode: () => void
  toggleSourceCode: () => void
}

type LayoutEngine = 'dagre' | 'elk' | 'tidy-tree'
type Direction = 'TB' | 'BT' | 'LR' | 'RL'

const DIRECTION_LABELS: Record<Direction, string> = {
  TB: '从上到下',
  BT: '从下到上',
  LR: '从左到右',
  RL: '从右到左',
}

const DIRECTION_ICONS: Record<Direction, Icon> = {
  TB: ArrowDownIcon,
  BT: ArrowUpIcon,
  LR: ArrowRightIcon,
  RL: ArrowLeftIcon,
}

const MIN_SCALE = 0.1
const MAX_SCALE = 5
const SCALE_STEP = 0.1

// Register layout loaders once
let elkRegistered = false
let tidyTreeRegistered = false

async function registerElkLayouts() {
  if (!elkRegistered) {
    mermaid.registerLayoutLoaders(elkLayouts)
    elkRegistered = true
  }
}

async function registerTidyTreeLayouts() {
  if (!tidyTreeRegistered) {
    mermaid.registerLayoutLoaders(tidyTreeLayouts)
    tidyTreeRegistered = true
  }
}

export const MermaidRenderer = forwardRef<MermaidRendererRef, MermaidRendererProps>(function MermaidRenderer({ code, className }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgContainerRef = useRef<HTMLDivElement>(null)
  const diagramContainerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string>('')
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [layout, setLayout] = useState<LayoutEngine>('dagre')
  const [direction, setDirection] = useState<Direction>('TB')
  const [showCodePanel, setShowCodePanel] = useState(false)
  const systemTheme = useSystemTheme()

  const { setContent } = useEditorStore()

  // Extract balanced braces content from a string starting at given position
  const extractBalancedBraces = useCallback((str: string, startPos: number): string | null => {
    if (str[startPos] !== '{') return null

    let depth = 0
    let i = startPos

    while (i < str.length) {
      if (str[i] === '{') depth++
      else if (str[i] === '}') {
        depth--
        if (depth === 0) {
          return str.slice(startPos, i + 1)
        }
      }
      i++
    }
    return null
  }, [])

  // Parse existing %%{init: {...}}%% directive and extract config
  const parseInitDirective = useCallback((mermaidCode: string): { config: Record<string, unknown>, remainingCode: string } => {
    const lines = mermaidCode.trim().split('\n')
    let config: Record<string, unknown> = {}
    let startIndex = 0

    // Skip frontmatter if present
    if (lines[0]?.trim() === '---') {
      const endIndex = lines.findIndex((line, idx) => idx > 0 && line.trim() === '---')
      if (endIndex > 0) {
        startIndex = endIndex + 1
      }
    }

    // Check for %%{init: {...}}%% directive
    const remainingText = lines.slice(startIndex).join('\n')
    const initStartMatch = remainingText.match(/^%%\{init:\s*/)

    if (initStartMatch) {
      const configStartPos = initStartMatch[0].length
      const configContent = extractBalancedBraces(remainingText, configStartPos)

      if (configContent) {
        try {
          // Parse the JSON-like config (convert single quotes to double quotes for JSON.parse)
          const configStr = configContent.replace(/'/g, '"')
          config = JSON.parse(configStr)
        } catch {
          // Keep empty config if parsing fails
          config = {}
        }

        // Find where the init directive ends (after }}%%)
        const directiveEndPos = configStartPos + configContent.length
        const afterDirective = remainingText.slice(directiveEndPos)
        // Remove the closing }%% and any whitespace
        const afterInit = afterDirective.replace(/^\s*\}%%\s*/, '').trim()
        return { config, remainingCode: afterInit }
      }
    }

    return { config: {}, remainingCode: remainingText }
  }, [extractBalancedBraces])

  // Inject layout and direction config into mermaid code, preserving user's theme config
  const injectConfig = useCallback((mermaidCode: string, layoutEngine: LayoutEngine, dir: Direction): string => {
    const { config: existingConfig, remainingCode } = parseInitDirective(mermaidCode)

    if (!remainingCode.trim()) return mermaidCode

    const diagramLines = remainingCode.split('\n')
    const firstDiagramLine = diagramLines[0]?.trim().toLowerCase() || ''

    // Merge configs: preserve user's theme settings, add layout if needed
    const mergedConfig: Record<string, unknown> = { ...existingConfig }
    mergedConfig.layout = layoutEngine

    // if (layoutEngine === 'elk') {
    //   mergedConfig.layout = 'elk'
    // }

    // Handle direction for flowchart/graph
    if (firstDiagramLine.startsWith('graph') || firstDiagramLine.startsWith('flowchart')) {
      // Replace or add direction in the diagram declaration
      const directionPattern = /^(graph|flowchart)\s*(TB|BT|LR|RL|TD)?/i
      if (directionPattern.test(diagramLines[0])) {
        diagramLines[0] = diagramLines[0].replace(directionPattern, `$1 ${dir}`)
      }
    }

    // Build the init directive string if we have config
    let initDirective = ''
    if (Object.keys(mergedConfig).length > 0) {
      // Convert config to mermaid init format with single quotes
      const configStr = JSON.stringify(mergedConfig)
        .replace(/"/g, "'")
      initDirective = `%%{init: ${configStr}}%%\n`
    }

    return initDirective + diagramLines.join('\n')
  }, [parseInitDirective])

  const renderDiagram = useCallback(async (mermaidCode: string) => {
    if (!mermaidCode.trim()) {
      setSvg('')
      setError(null)
      return
    }

    try {
      // Register layout loaders as needed
      if (layout === 'elk') {
        await registerElkLayouts()
      } else if (layout === 'tidy-tree') {
        await registerTidyTreeLayouts()
      }

      const isDark = systemTheme === 'dark'

      // Initialize mermaid with base config
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'base',
        securityLevel: 'loose',
        fontFamily: 'inherit',
        themeVariables: isDark ? {
          // 暗色莫兰迪 - Dark Mode
          primaryColor: '#1e293b', // slate-800
          primaryTextColor: '#e2e8f0', // slate-200
          primaryBorderColor: '#475569', // slate-600
          lineColor: '#94a3b8', // slate-400
          secondaryColor: '#334155',
          tertiaryColor: '#1e293b',
        } : {
          // 基础颜色 - 莫兰迪蓝 (Light Mode)
          primaryColor: '#e3f2fd',
          primaryTextColor: '#0d47a1',
          primaryBorderColor: '#2196f3',
          lineColor: '#546e7a',
          // 思维导图分支配色 (cScale0-11) - 低饱和度莫兰迪色系
          cScale0: '#e3f2fd',  // 莫兰迪蓝 (主色)
          cScale1: '#fff3e0',  // 莫兰迪橙
          cScale2: '#e8f5e9',  // 莫兰迪绿
          cScale3: '#f3e5f5',  // 莫兰迪紫
          cScale4: '#fce4ec',  // 莫兰迪粉
          cScale5: '#e0f7fa',  // 莫兰迪青
          cScale6: '#fff8e1',  // 莫兰迪黄
          cScale7: '#efebe9',  // 莫兰迪棕
          cScale8: '#e8eaf6',  // 莫兰迪靛
          cScale9: '#f1f8e9',  // 莫兰迪草绿
          cScale10: '#fbe9e7', // 莫兰迪珊瑚
          cScale11: '#e1f5fe', // 莫兰迪天蓝
          // 对应的文字颜色
          cScaleLabel0: '#0d47a1',
          cScaleLabel1: '#e65100',
          cScaleLabel2: '#1b5e20',
          cScaleLabel3: '#4a148c',
          cScaleLabel4: '#880e4f',
          cScaleLabel5: '#006064',
          cScaleLabel6: '#ff6f00',
          cScaleLabel7: '#3e2723',
          cScaleLabel8: '#1a237e',
          cScaleLabel9: '#33691e',
          cScaleLabel10: '#bf360c',
          cScaleLabel11: '#01579b',
        },
      })

      const codeWithConfig = injectConfig(mermaidCode, layout, direction)

      // Validate syntax first
      await mermaid.parse(codeWithConfig)

      // Render the diagram
      const id = `mermaid-${Date.now()}`
      const { svg: renderedSvg } = await mermaid.render(id, codeWithConfig)
      setSvg(renderedSvg)
      setError(null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Mermaid 语法无效'
      setError(errorMessage)
      setSvg('')
    }
  }, [injectConfig, layout, direction, systemTheme])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void renderDiagram(code)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [code, renderDiagram])

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setScale(prev => Math.min(prev + SCALE_STEP, MAX_SCALE))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale(prev => Math.max(prev - SCALE_STEP, MIN_SCALE))
  }, [])

  const handleResetView = useCallback(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [])

  // Native wheel event handler for proper preventDefault
  useEffect(() => {
    const container = diagramContainerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+滚轮：缩放
        e.preventDefault()
        const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP
        setScale(prev => Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta)))
      } else {
        // 普通滚轮：上下滚动（平移）
        e.preventDefault()
        setPosition(prev => ({
          x: prev.x,
          y: prev.y - e.deltaY,
        }))
      }
    }

    // Use passive: false to allow preventDefault
    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [svg])

  // Keyboard zoom
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        handleZoomIn()
      } else if (e.key === '-') {
        e.preventDefault()
        handleZoomOut()
      } else if (e.key === '0') {
        e.preventDefault()
        handleResetView()
      }
    }
  }, [handleZoomIn, handleZoomOut, handleResetView])

  // Pan controls
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true)
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
    }
  }, [position])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      })
    }
  }, [isDragging, dragStart])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Export functions
  const exportAsSvg = useCallback((withBackground: boolean = true) => {
    if (!svg) return

    const finalSvg = svg
    if (withBackground) {
      // Background is already part of the mermaid rendered SVG usually, 
      // but if we want to ensure it for export:
      // Note: Mermaid typically doesn't include a background rect in SVG unless themed.
    }

    const blob = new Blob([finalSvg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `图表-${Date.now()}.svg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [svg])

  const exportAsPng = useCallback(async (withBackground: boolean = true) => {
    if (!svg || !svgContainerRef.current) return

    const svgElement = svgContainerRef.current.querySelector('svg')
    if (!svgElement) return

    // Get SVG dimensions
    const bbox = svgElement.getBBox()
    const width = bbox.width || svgElement.clientWidth || 800
    const height = bbox.height || svgElement.clientHeight || 600

    // Create canvas
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size with higher resolution for better quality
    const exportScale = 4
    canvas.width = width * exportScale
    canvas.height = height * exportScale
    ctx.scale(exportScale, exportScale)

    // Fill background if requested
    if (withBackground) {
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, width, height)
    } else {
      ctx.clearRect(0, 0, width, height)
    }

    // Convert SVG to base64 data URL to avoid tainted canvas issue
    const svgData = new XMLSerializer().serializeToString(svgElement)
    const svgBase64 = btoa(unescape(encodeURIComponent(svgData)))
    const dataUrl = `data:image/svg+xml;base64,${svgBase64}`

    const img = new window.Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height)

      // Download
      const link = document.createElement('a')
      link.download = `图表-${Date.now()}.png`
      link.href = canvas.toDataURL('image/png')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
    img.onerror = (err) => {
      console.error('Failed to load SVG for PNG export:', err)
    }
    img.src = dataUrl
  }, [svg])
  
  const copyAsPng = useCallback(async (withBackground: boolean = true) => {
    if (!svg || !svgContainerRef.current) return

    const svgElement = svgContainerRef.current.querySelector('svg')
    if (!svgElement) return

    const bbox = svgElement.getBBox()
    const width = bbox.width || svgElement.clientWidth || 800
    const height = bbox.height || svgElement.clientHeight || 600

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const exportScale = 4
    canvas.width = width * exportScale
    canvas.height = height * exportScale
    ctx.scale(exportScale, exportScale)

    if (withBackground) {
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, width, height)
    }

    const svgData = new XMLSerializer().serializeToString(svgElement)
    const svgBase64 = btoa(unescape(encodeURIComponent(svgData)))
    const dataUrl = `data:image/svg+xml;base64,${svgBase64}`

    return new Promise<void>((resolve, reject) => {
      const img = new window.Image()
      img.onload = async () => {
        try {
          ctx.drawImage(img, 0, 0, width, height)
          canvas.toBlob(async (blob) => {
            if (blob) {
              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
              ])
              resolve()
            } else {
              reject(new Error('生成图片失败'))
            }
          }, 'image/png')
        } catch (err) {
          reject(err)
        }
      }
      img.onerror = reject
      img.src = dataUrl
    })
  }, [svg])

  // Export as source (.mmd file)
  const exportAsSource = useCallback(() => {
    if (!code) return

    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `图表-${Date.now()}.mmd`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [code])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    exportAsSvg,
    exportAsPng,
    copyAsPng,
    exportAsSource,
    showSourceCode: () => setShowCodePanel(true),
    hideSourceCode: () => setShowCodePanel(false),
    toggleSourceCode: () => setShowCodePanel(prev => !prev),
  }), [exportAsSvg, exportAsPng, copyAsPng, exportAsSource])

  // Layout change handler
  const handleLayoutChange = useCallback((value: string) => {
    setLayout(value as LayoutEngine)
  }, [])

  // Direction change handler
  const handleDirectionChange = useCallback((value: string) => {
    setDirection(value as Direction)
  }, [])

  // Apply code changes from SourceCodePanel
  const handleApplyCode = useCallback((newCode: string) => {
    if (newCode.trim() && newCode !== code) {
      setContent(newCode)
    }
  }, [code, setContent])

  if (!code.trim()) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center text-kumo-subtle',
          className
        )}
      >
        <div className="text-center">
          <p className="text-sm">暂无图表</p>
          <p className="mt-1 text-xs">可以用 AI 生成一个</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-center p-4',
          className
        )}
      >
        <div className="max-w-md rounded-lg border border-kumo-danger bg-kumo-danger/10 p-4">
          <p className="font-medium text-kumo-danger">语法错误</p>
          <p className="mt-1 text-sm text-kumo-danger">{error}</p>
        </div>
      </div>
    )
  }

  const DirectionIcon = DIRECTION_ICONS[direction]

  return (
    <TooltipProvider>
      <div
        ref={containerRef}
        className={cn('relative flex h-full flex-col', className)}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 border-b border-kumo-line bg-kumo-base px-2 py-2">
          {/* Layout selector */}
          <DropdownMenu>
            <Tooltip
              content="布局引擎"
              render={(props) => (
                <DropdownMenu.Trigger
                  render={(triggerProps: React.HTMLAttributes<HTMLButtonElement>) => (
                    <Button {...props} {...triggerProps} variant="ghost" size="sm" className="gap-1.5">
                      {layout === 'elk' ? (
                        <GridFourIcon className="h-4 w-4" />
                      ) : layout === 'tidy-tree' ? (
                        <NetworkIcon className="h-4 w-4" />
                      ) : (
                        <GitBranchIcon className="h-4 w-4" />
                      )}
                      <span className="text-xs">
                        {layout === 'elk' ? 'ELK' : layout === 'tidy-tree' ? 'Tidy Tree' : 'Dagre'}
                      </span>
                    </Button>
                  )}
                />
              )}
            />
            <DropdownMenu.Content>
              <DropdownMenu.RadioGroup value={layout} onValueChange={handleLayoutChange}>
                <DropdownMenu.RadioItem value="dagre">Dagre (默认)</DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="elk">ELK (层次化)</DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="tidy-tree">Tidy Tree (思维导图专用)</DropdownMenu.RadioItem>
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu>

          {/* Direction selector */}
          <DropdownMenu>
            <Tooltip
              content="图表方向"
              render={(props) => (
                <DropdownMenu.Trigger
                  render={(triggerProps: React.HTMLAttributes<HTMLButtonElement>) => (
                    <Button {...props} {...triggerProps} variant="ghost" size="sm" className="gap-1.5">
                      <DirectionIcon className="h-4 w-4" />
                      <span className="text-xs">{DIRECTION_LABELS[direction]}</span>
                    </Button>
                  )}
                />
              )}
            />
            <DropdownMenu.Content>
              <DropdownMenu.RadioGroup value={direction} onValueChange={handleDirectionChange}>
                <DropdownMenu.RadioItem value="TB">
                  <ArrowDownIcon className="mr-2 h-4 w-4" />
                  从上到下
                </DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="BT">
                  <ArrowUpIcon className="mr-2 h-4 w-4" />
                  从下到上
                </DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="LR">
                  <ArrowRightIcon className="mr-2 h-4 w-4" />
                  从左到右
                </DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="RL">
                  <ArrowLeftIcon className="mr-2 h-4 w-4" />
                  从右到左
                </DropdownMenu.RadioItem>
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu>

          <div className="mx-1 h-4 w-px bg-kumo-line" />

          {/* Zoom controls */}
          <Tooltip
            content="缩小"
            render={(props) => (
              <Button {...props} variant="ghost" size="sm" onClick={handleZoomOut}>
                <MagnifyingGlassMinusIcon className="h-4 w-4" />
              </Button>
            )}
          />

          <span className="min-w-[3rem] text-center text-xs text-kumo-subtle">
            {Math.round(scale * 100)}%
          </span>

          <Tooltip
            content="放大"
            render={(props) => (
              <Button {...props} variant="ghost" size="sm" onClick={handleZoomIn}>
                <MagnifyingGlassPlusIcon className="h-4 w-4" />
              </Button>
            )}
          />

          <Tooltip
            content="重置视图"
            render={(props) => (
              <Button {...props} variant="ghost" size="sm" onClick={handleResetView}>
                <ArrowClockwiseIcon className="h-4 w-4" />
              </Button>
            )}
          />



        </div>

        {/* Diagram container */}
        <div
          ref={diagramContainerRef}
          className="flex-1 overflow-hidden"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <div
            ref={svgContainerRef}
            className="flex h-full w-full items-center justify-center p-8"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>

        {/* Zoom hint */}
        <div className={cn(
          "absolute bottom-2 right-2 text-xs text-kumo-subtle opacity-60",
          showCodePanel && "right-[340px]"
        )}>
          滚轮滚动 | Ctrl+滚轮缩放 | 拖拽平移
        </div>

        {/* Code Panel */}
        {showCodePanel && (
          <SourceCodePanel
            code={code}
            language="mermaid"
            title="Mermaid 源码"
            onApply={handleApplyCode}
            onClose={() => setShowCodePanel(false)}
          />
        )}
      </div>
    </TooltipProvider>
  )
})
