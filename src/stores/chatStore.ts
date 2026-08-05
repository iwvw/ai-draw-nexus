import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { ChatMessage, Attachment } from '@/types'
import { ChatService } from '@/services/chatService'

interface ChatState {
  // UI messages for display
  messages: ChatMessage[]
  // Initial prompt from Quick Start (Path A)
  initialPrompt: string | null
  // Initial attachments from Quick Start (Path A)
  initialAttachments: Attachment[] | null
  // Streaming state
  isStreaming: boolean

  // Actions
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => string
  updateMessage: (id: string, data: Partial<ChatMessage>) => void
  clearMessages: () => void
  setInitialPrompt: (prompt: string | null, attachments?: Attachment[] | null) => void
  clearInitialPrompt: () => void

  currentProjectId: string | null

  setProjectId: (id: string | null) => void
  setStreaming: (streaming: boolean) => void
  // Load conversation from the server (account-scoped, SQLite)
  loadHistory: (projectId: string) => Promise<void>

  // Set when loadHistory finishes, so initial-prompt consumers know the
  // history has been applied (loadHistory overwrites messages).
  historyLoadedForProject: string | null
}

/**
 * Chat store is a UI in-memory store only. Every message is persisted to the
 * backend SQLite database scoped to the signed-in account; nothing is stored
 * in the browser.
 */
export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  initialPrompt: null,
  initialAttachments: null,
  isStreaming: false,
  currentProjectId: null,
  historyLoadedForProject: null,

  addMessage: (message) => {
    const id = uuidv4()
    const newMessage: ChatMessage = {
      ...message,
      id,
      timestamp: new Date(),
    }

    set((state) => ({
      messages: [...state.messages, newMessage],
    }))

    const projectId = get().currentProjectId
    if (projectId) {
      ChatService.createMessage({
        id,
        projectId,
        role: message.role,
        content: message.content,
        status: message.status,
        attachments: message.attachments,
      }).catch((err) => console.error('Failed to persist chat message:', err))
    }

    return id
  },

  updateMessage: (id: string, data: Partial<ChatMessage>) => {
    set((state) => ({
      messages: state.messages.map((msg) => (msg.id === id ? { ...msg, ...data } : msg)),
    }))

    ChatService.updateMessage(id, {
      ...(data.content !== undefined ? { content: data.content } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.attachments !== undefined ? { attachments: data.attachments } : {}),
    }).catch((err) => console.error('Failed to update chat message:', err))
  },

  clearMessages: () => {
    const projectId = get().currentProjectId
    set({ messages: [] })
    if (projectId) {
      ChatService.clearHistory(projectId).catch((err) => console.error('Failed to clear chat history:', err))
    }
  },

  setInitialPrompt: (prompt: string | null, attachments?: Attachment[] | null) =>
    set({ initialPrompt: prompt, initialAttachments: attachments ?? null }),

  clearInitialPrompt: () => set({ initialPrompt: null, initialAttachments: null }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setProjectId: (id) => set({ currentProjectId: id }),

  loadHistory: async (projectId) => {
    const messages = await ChatService.getHistory(projectId)
    set({ currentProjectId: projectId, messages, historyLoadedForProject: projectId })
  },
}))
