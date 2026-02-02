import { useState, useEffect, useRef, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Excalidraw, exportToBlob, exportToSvg, getSceneVersion, restoreElements, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { useSystemTheme } from '@/hooks/useSystemTheme'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { cn } from '@/lib/utils'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { SourceCodePanel } from '@/components/ui/SourceCodePanel'

interface ExcalidrawEditorProps {
  data: string // JSON string
  onChange?: (data: string) => void
  className?: string
}

export interface ExcalidrawEditorRef {
  exportAsSvg: () => void
  exportAsPng: () => void
  exportAsSource: () => void
  showSourceCode: () => void
  hideSourceCode: () => void
  toggleSourceCode: () => void
}

// Use generic types to avoid strict Excalidraw type requirements
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawElementAny = any

interface ExcalidrawData {
  elements: ExcalidrawElementAny[]
  appState?: Record<string, unknown>
}

/**
 * Fix Excalidraw bug: when line element has width === 0 or height === 0,
 * it causes rendering issues. This function fixes by setting them to 1.
 */
function fixZeroDimensionElements(elements: ExcalidrawElementAny[]): ExcalidrawElementAny[] {
  return elements.map(element => {
    // Only fix line-type elements (line, arrow)
    if (element.type === 'line' || element.type === 'arrow') {
      const needsFix = element.width === 0 || element.height === 0
      if (needsFix) {
        return {
          ...element,
          width: element.width === 0 ? 1 : element.width,
          height: element.height === 0 ? 1 : element.height,
        }
      }
    }
    return element
  })
}

/**
 * Check if elements are full Excalidraw elements (saved from editor)
 * vs skeleton elements (from AI generation).
 * Full elements have versionNonce and seed, skeleton elements don't.
 */
function isFullExcalidrawElements(elements: ExcalidrawElementAny[]): boolean {
  if (elements.length === 0) return false
  // Check if first element has properties that only full elements have
  const firstElement = elements[0]
  return typeof firstElement.versionNonce === 'number' && typeof firstElement.seed === 'number'
}

/**
 * Convert elements to Excalidraw format with proper binding restoration.
 * For full elements (from saved versions), use restoreElements directly.
 * For skeleton elements (from AI), use convertToExcalidrawElements first.
 */
function prepareExcalidrawElements(elements: ExcalidrawElementAny[]): ExcalidrawElementAny[] {
  const fixedElements = fixZeroDimensionElements(elements)

  if (isFullExcalidrawElements(fixedElements)) {
    // Full elements from saved versions - restore directly with binding repair
    return restoreElements(fixedElements, null, { repairBindings: true })
  } else {
    // Skeleton elements from AI - convert first, then restore
    return restoreElements(
      convertToExcalidrawElements(fixedElements),
      null,
      { repairBindings: true }
    )
  }
}

export const ExcalidrawEditor = forwardRef<ExcalidrawEditorRef, ExcalidrawEditorProps>(function ExcalidrawEditor({ data, onChange, className }, ref) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCodePanel, setShowCodePanel] = useState(false)
  const systemTheme = useSystemTheme()

  // Refs for tracking scene version and preventing loops
  const lastSceneVersionRef = useRef(0)
  const skipProgrammaticChangeRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null)
  // Track the initial data prop to detect external changes (e.g., AI generation, version restore)
  const initialDataPropRef = useRef(data)
  // Debounce timer for onChange
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Parse initial data - only computed once on mount
  // Subsequent data changes are handled via updateScene in useEffect
  const initialData = useMemo<ExcalidrawData | null>(() => {
    const dataToUse = initialDataPropRef.current
    if (!dataToUse.trim()) {
      return { elements: [] }
    }

    try {
      const parsed = JSON.parse(dataToUse)
      // Support both formats:
      // 1. Direct array: [{ id, type, x, y, ... }, ...]
      // 2. Object format: { elements: [...] }
      let elementsData: ExcalidrawElementAny[]
      if (Array.isArray(parsed)) {
        elementsData = parsed
      } else if (parsed.elements && Array.isArray(parsed.elements)) {
        elementsData = parsed.elements
      } else {
        throw new Error('Invalid Excalidraw data: expected array or object with elements')
      }

      // Prepare elements with proper binding handling
      const restoredElements = prepareExcalidrawElements(elementsData)

      return { elements: restoredElements }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Invalid JSON'
      setError(errorMessage)
      return { elements: [] }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep onChange ref up to date
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Keep excalidrawAPI ref up to date
  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI
  }, [excalidrawAPI])

  // Clear error when data is valid
  useEffect(() => {
    if (data.trim()) {
      try {
        const parsed = JSON.parse(data)
        // Support both array format and object format
        if (Array.isArray(parsed) || (parsed.elements && Array.isArray(parsed.elements))) {
          setError(null)
        }
      } catch {
        // Error already set in useMemo
      }
    } else {
      setError(null)
    }
  }, [data])

  // Update canvas when data prop changes from external source (e.g., AI generation, version restore)
  // This should NOT run when data changes due to user drawing
  useEffect(() => {
    if (!excalidrawAPI || !data.trim()) return

    // Skip if this change originated from user drawing (handleChange already updated the ref)
    if (data === initialDataPropRef.current) {
      return
    }

    try {
      const parsed = JSON.parse(data)
      const elementsData = Array.isArray(parsed) ? parsed : parsed.elements

      if (!Array.isArray(elementsData)) return

      // Prepare elements with proper binding handling
      const restoredElements = prepareExcalidrawElements(elementsData)

      // Mark as programmatic change and update scene
      skipProgrammaticChangeRef.current = true
      lastSceneVersionRef.current = getSceneVersion(restoredElements)
      initialDataPropRef.current = data

      excalidrawAPI.updateScene({
        elements: restoredElements,
        appState: { isLoading: false },
      })

      // Scroll to content center after scene update with a small delay
      // to ensure the scene is fully rendered
      setTimeout(() => {
        excalidrawAPI.scrollToContent(restoredElements, {
          fitToContent: true,
          animate: true,
          duration: 300,
        })
      }, 100)
    } catch {
      // Invalid JSON, ignore
    }
  }, [data, excalidrawAPI])

  // Apply code changes from SourceCodePanel
  const handleApplyCode = useCallback((newCode: string) => {
    if (!newCode.trim() || !excalidrawAPI) return

    try {
      const parsed = JSON.parse(newCode)
      const elementsData = Array.isArray(parsed) ? parsed : parsed.elements

      if (!Array.isArray(elementsData)) {
        console.error('Invalid Excalidraw data format')
        return
      }

      const restoredElements = prepareExcalidrawElements(elementsData)

      excalidrawAPI.updateScene({
        elements: restoredElements,
        appState: { isLoading: false },
      })

      onChange?.(newCode)
    } catch (err) {
      console.error('Failed to apply code:', err)
    }
  }, [excalidrawAPI, onChange])

  // Export as SVG
  const exportAsSvg = useCallback(async () => {
    if (!excalidrawAPI) return

    try {
      const elements = excalidrawAPI.getSceneElements()
      const appState = excalidrawAPI.getAppState()
      const files = excalidrawAPI.getFiles()

      const svg = await exportToSvg({
        elements,
        appState: {
          ...appState,
          exportWithDarkMode: false,
        },
        files,
      })

      const svgString = new XMLSerializer().serializeToString(svg)
      const blob = new Blob([svgString], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `diagram-${Date.now()}.svg`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export SVG:', err)
    }
  }, [excalidrawAPI])

  // Export as PNG
  const exportAsPng = useCallback(async () => {
    if (!excalidrawAPI) return

    try {
      const elements = excalidrawAPI.getSceneElements()
      const appState = excalidrawAPI.getAppState()
      const files = excalidrawAPI.getFiles()

      const blob = await exportToBlob({
        elements,
        appState: {
          ...appState,
          exportWithDarkMode: false,
        },
        files,
        getDimensions: (width: number, height: number) => ({
          width: width * 2,
          height: height * 2,
          scale: 2,
        }),
      })

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `diagram-${Date.now()}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export PNG:', err)
    }
  }, [excalidrawAPI])

  // Export as source (.excalidraw file - JSON format)
  const exportAsSource = useCallback(() => {
    if (!excalidrawAPI) return

    try {
      const elements = excalidrawAPI.getSceneElements()
      const appState = excalidrawAPI.getAppState()
      const files = excalidrawAPI.getFiles()

      const exportData = {
        type: 'excalidraw',
        version: 2,
        source: 'https://excalidraw.com',
        elements,
        appState: {
          gridSize: appState.gridSize,
          viewBackgroundColor: appState.viewBackgroundColor,
        },
        files,
      }

      const jsonString = JSON.stringify(exportData, null, 2)
      const blob = new Blob([jsonString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `diagram-${Date.now()}.excalidraw`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export source:', err)
    }
  }, [excalidrawAPI])

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    exportAsSvg,
    exportAsPng,
    exportAsSource,
    showSourceCode: () => setShowCodePanel(true),
    hideSourceCode: () => setShowCodePanel(false),
    toggleSourceCode: () => setShowCodePanel(prev => !prev),
  }), [exportAsSvg, exportAsPng, exportAsSource])

  // Handle changes from Excalidraw - use version tracking and debounce
  const handleChange = useCallback((
    elements: readonly ExcalidrawElementAny[],
  ) => {
    if (!elements) return

    const currentVersion = getSceneVersion(elements as ExcalidrawElementAny[])

    // Skip programmatic changes (from external data updates like AI generation)
    if (skipProgrammaticChangeRef.current) {
      skipProgrammaticChangeRef.current = false
      lastSceneVersionRef.current = currentVersion
      return
    }

    // Skip if version hasn't changed
    if (currentVersion === lastSceneVersionRef.current) {
      return
    }

    lastSceneVersionRef.current = currentVersion

    // Debounce the onChange callback to avoid performance issues during drawing
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      // Get the latest elements from the API if available
      const api = excalidrawAPIRef.current
      const sceneElements = api ? api.getSceneElements() : elements

      if (onChangeRef.current) {
        const exportData: ExcalidrawData = {
          elements: sceneElements as ExcalidrawElementAny[],
        }
        const jsonData = JSON.stringify(exportData, null, 2)
        initialDataPropRef.current = jsonData
        onChangeRef.current(jsonData)
      }
    }, 300)
  }, [])

  if (error && data.trim()) {
    return (
      <div className={cn('flex h-full items-center justify-center p-4', className)}>
        <div className="max-w-md border border-red-300 bg-red-50 p-4">
          <p className="font-medium text-red-800">Invalid Excalidraw Data</p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
        </div>
      </div>
    )
  }

  if (!initialData) {
    return (
      <div className={cn('flex h-full items-center justify-center', className)}>
        <p className="text-muted">Loading...</p>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className={cn('relative h-full w-full', className)}>


        {/* Excalidraw Canvas */}
        <Excalidraw
          initialData={initialData}
          onChange={handleChange}
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          theme={systemTheme}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              export: false,
              saveAsImage: false,
            },
          }}
        />

        {/* Code Panel */}
        {showCodePanel && (
          <SourceCodePanel
            code={data}
            language="json"
            title="Excalidraw 源码"
            onApply={handleApplyCode}
            onClose={() => setShowCodePanel(false)}
          />
        )}
      </div>
    </TooltipProvider>
  )
})

/**
 * Export Excalidraw canvas as thumbnail
 */
export async function exportExcalidrawThumbnail(
  api: ExcalidrawImperativeAPI
): Promise<string> {
  const elements = api.getSceneElements()
  const appState = api.getAppState()

  const blob = await exportToBlob({
    elements,
    appState: {
      ...appState,
      exportWithDarkMode: false,
    },
    files: null,
    getDimensions: () => ({ width: 300, height: 200, scale: 1 }),
  })

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
