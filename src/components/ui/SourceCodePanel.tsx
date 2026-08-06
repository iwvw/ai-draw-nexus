import { useState, useCallback, useEffect } from 'react'
import Editor from 'react-simple-code-editor'
import Prism from 'prismjs'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-markup'
import 'prismjs/themes/prism.css'
import { Button, LayerCard, Tooltip } from '@cloudflare/kumo'
import { cn } from '@/lib/utils'
import { ArrowCounterClockwiseIcon, CheckIcon, CopyIcon, PlayIcon, XIcon } from '@phosphor-icons/react'

export type SourceLanguage = 'json' | 'xml' | 'mermaid'

interface SourceCodePanelProps {
  code: string
  language: SourceLanguage
  title: string
  onApply: (code: string) => void
  onClose: () => void
  className?: string
}

const highlightCode = (code: string, language: SourceLanguage): string => {
  if (language === 'json') {
    return Prism.highlight(code, Prism.languages.json, 'json')
  } else if (language === 'xml') {
    return Prism.highlight(code, Prism.languages.markup, 'markup')
  } else {
    // mermaid - use plain text highlighting
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}

export function SourceCodePanel({
  code,
  language,
  title,
  onApply,
  onClose,
  className,
}: SourceCodePanelProps) {
  const [editedCode, setEditedCode] = useState(code)
  const [hasChanges, setHasChanges] = useState(false)
  const [copied, setCopied] = useState(false)

  // Sync editedCode when code prop changes
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setEditedCode(code)
      setHasChanges(false)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [code])

  // Handle code change
  const handleCodeChange = useCallback((value: string) => {
    setEditedCode(value)
    setHasChanges(value !== code)
  }, [code])

  // Copy code handler
  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy code:', err)
    }
  }, [editedCode])

  // Apply code changes
  const handleApplyCode = useCallback(() => {
    if (editedCode.trim() && hasChanges) {
      onApply(editedCode)
      setHasChanges(false)
    }
  }, [editedCode, hasChanges, onApply])

  // Reset code to original
  const handleResetCode = useCallback(() => {
    setEditedCode(code)
    setHasChanges(false)
  }, [code])

  return (
    <LayerCard className={cn(
      'absolute bottom-4 left-4 right-4 z-10 flex max-h-[70%] flex-col p-0 shadow-lg sm:left-auto sm:w-96',
      className
    )}>
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-kumo-line px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-kumo-strong">{title}</span>
          {hasChanges && (
            <span className="text-xs text-kumo-warning">• 未保存</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip
            content={copied ? '已复制' : '复制代码'}
            render={(props) => (
              <Button
                {...props}
                variant="secondary"
                size="sm"
                shape="square"
                aria-label={copied ? '已复制' : '复制代码'}
                onClick={handleCopyCode}
              >
                {copied ? (
                  <CheckIcon className="h-3.5 w-3.5 text-kumo-success" />
                ) : (
                  <CopyIcon className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          />
          <Button
            variant="secondary"
            size="sm"
            shape="square"
            aria-label="关闭源码面板"
            onClick={onClose}
          >
            <XIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Code Editor */}
      <div className="min-h-0 flex-1 overflow-auto bg-kumo-recessed" style={{ height: '300px' }}>
        <Editor
          value={editedCode}
          onValueChange={handleCodeChange}
          highlight={(code) => highlightCode(code, language)}
          padding={12}
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            fontSize: 13,
            lineHeight: 1.5,
            minHeight: '100%',
            color: 'inherit',
            background: 'transparent',
          }}
          textareaClassName="focus:outline-none"
        />
      </div>

      {/* Panel Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-kumo-line px-3 py-2">
        <Tooltip
          content="重置为原始代码"
          render={(props) => (
            <Button
              {...props}
              variant="secondary"
              size="sm"
              onClick={handleResetCode}
              disabled={!hasChanges}
              className="gap-1.5"
            >
              <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" />
              <span className="text-xs">重置</span>
            </Button>
          )}
        />
        <Tooltip
          content="应用代码更改"
          render={(props) => (
            <Button
              {...props}
              variant="primary"
              size="sm"
              onClick={handleApplyCode}
              disabled={!hasChanges || !editedCode.trim()}
              className="gap-1.5"
            >
              <PlayIcon className="h-3.5 w-3.5" />
              <span className="text-xs">应用</span>
            </Button>
          )}
        />
      </div>
    </LayerCard>
  )
}
