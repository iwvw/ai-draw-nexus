import { useChatStore } from '@/stores/chatStore'
import { useEditorStore } from '@/stores/editorStore'
import { ProjectService } from '@/services/projectService'
import { submitGenerateTask, pollGenerateTask } from '@/services/generateTaskService'
import { generateThumbnail } from '@/lib/thumbnail'
import { useToast } from '@/hooks/useToast'
import type { Attachment } from '@/types'

export function useAIGenerate() {
  const { setStreaming } = useChatStore()

  const {
    currentProject,
    setContentFromVersion,
    setLoading,
    setProject,
  } = useEditorStore()

  const { success, error: showError } = useToast()

  /**
   * Generate diagram using AI with streaming support
   * @param userInput - User's description or modification request
   * @param isInitial - Whether this is initial generation (empty canvas)
   * @param attachments - Optional attachments (images or documents)
   */
  const generate = async (
    userInput: string,
    isInitial: boolean,
    attachments?: Attachment[]
  ) => {
    if (!currentProject) return

    const engineType = currentProject.engineType

    // 异步任务驱动：UI 用仅本地乐观消息，完成后由后端 loadHistory 拉取权威对话。
    const { addLocal, updateLocal, loadHistory } = useChatStore.getState()

    // Add user message to UI (with attachments)
    addLocal({
      role: 'user',
      content: userInput,
      status: 'complete',
      attachments,
    })

    // Add assistant message placeholder
    const assistantMsgId = addLocal({
      role: 'assistant',
      content: '…',
      status: 'streaming',
    })

    setStreaming(true)
    setLoading(true)

try {
      // 后端异步生成任务：前端不再组装提示词/生成/校验，只提交并轮询。
      // 文档/URL 附件的内容并入 prompt，确保 AI 能读到附件信息。
      const attachmentText = (attachments ?? [])
        .filter((att) => att.type === 'document' || att.type === 'url')
        .map((att) => {
          const a = att as { type: 'document' | 'url'; content: string; fileName?: string; title?: string }
          const name = a.fileName ?? a.title ?? ''
          return name ? `附件「${name}」内容：\n${a.content}` : a.content
        })
        .join('\n\n')
      const fullPrompt = attachmentText ? `${userInput}\n\n--- 附件内容 ---\n${attachmentText}` : userInput

      const { task_id } = await submitGenerateTask({
        projectId: currentProject.id,
        engine: engineType,
        prompt: fullPrompt,
        changeSummary: isInitial ? '初始生成' : 'AI 修改',
        attachments,
      })

      // 轮询直至后端完成（后台 worker 生成并持久化 version + chat）。
      const result = await pollGenerateTask(task_id, 1200, 1_800_000, (t) => {
        if (t.status === 'running' || t.status === 'pending') {
          updateLocal(assistantMsgId, { content: '正在生成图表...', status: 'streaming' })
        }
      })

      if (result.status === 'error') {
        throw new Error(result.error || '生成失败')
      }

      const finalCode = result.content || ''
      if (!finalCode.trim()) {
        throw new Error('生成结果为空')
      }

// Update content (AI generation auto-saves, so mark as saved)
      setContentFromVersion(finalCode)

      // Update assistant message (local optimistic)
      updateLocal(assistantMsgId, {
        content: finalCode,
        status: 'complete',
      })

      // 后端已全链路持久化 version + chat。从前端重载权威对话，与后端状态一致。
      try {
        await loadHistory(currentProject.id)
      } catch {
        // 非致命：本地乐观消息已足够展示
      }

      // Generate and save thumbnail
      // For drawio, use the registered thumbnailGetter from CanvasArea for accurate rendering
      try {
        let thumbnail: string = ''
        if (engineType === 'drawio') {
          // For drawio, wait a bit for the editor to be ready after content update
          // Then retry getting thumbnail with delay
          const getThumbnailWithRetry = async (maxRetries = 3, delay = 500): Promise<string> => {
            for (let i = 0; i < maxRetries; i++) {
              // Wait for editor to process the new content
              await new Promise(resolve => setTimeout(resolve, delay))
              // Get fresh thumbnailGetter from store
              const getter = useEditorStore.getState().thumbnailGetter
              if (getter) {
                const result = await getter()
                if (result) return result
              }
            }
            return ''
          }
          thumbnail = await getThumbnailWithRetry()
        } else {
          // Use fallback method for other engines
          thumbnail = await generateThumbnail(finalCode, engineType)
        }
        if (thumbnail) {
          await ProjectService.update(currentProject.id, { thumbnail })
          // Update currentProject in store so thumbnail is visible immediately
          setProject({ ...currentProject, thumbnail })
        }
      } catch (err) {
        console.error('Failed to generate thumbnail:', err)
      }

      // Update project timestamp
      await ProjectService.update(currentProject.id, {})

      success('图表生成成功')

} catch (error) {
      console.error('AI generation failed:', error)
      updateLocal(assistantMsgId, {
        content: `错误：${error instanceof Error ? error.message : '生成失败'}`,
        status: 'error',
      })
      showError(error instanceof Error ? error.message : '生成失败')
    } finally {
      setStreaming(false)
      setLoading(false)
    }
  }

  /**
   * Retry the last AI request using the current payload context
   * @param assistantMessageId - Optional existing assistant message to update in-place
   */
  const retryLast = async (assistantMessageId?: string) => {
    if (!currentProject) return

    const msgs = useChatStore.getState().messages
    let prompt = ''
    if (assistantMessageId) {
      const idx = msgs.findIndex((m) => m.id === assistantMessageId)
      if (idx >= 0) {
        for (let i = idx - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') { prompt = msgs[i].content; break }
        }
      }
    }
    if (!prompt) {
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
      if (lastUser) prompt = lastUser.content
    }
    if (!prompt) { showError('没有可重新发送的上下文'); return }
    // 复用任务驱动生成：后端异步重跑该 prompt。
    await generate(prompt, false)
  }



  return { generate, retryLast }
}
