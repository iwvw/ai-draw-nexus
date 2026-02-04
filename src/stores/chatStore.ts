import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { ChatMessage, Attachment } from '@/types'

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
  currentProjectId: string | null
  // Store chat history for all projects: projectId -> messages
  history: Record<string, ChatMessage[]>

  setProjectId: (id: string | null) => void // Deprecated, use switchProject
  switchProject: (projectId: string) => void
  setStreaming: (streaming: boolean) => void
}

import { persist, createJSONStorage } from 'zustand/middleware'

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      history: {},
      initialPrompt: null,
      initialAttachments: null,
      isStreaming: false,
      currentProjectId: null,

      addMessage: (message) => {
        const id = uuidv4()
        const newMessage: ChatMessage = {
          ...message,
          id,
          timestamp: new Date(),
        }

        set((state) => {
          const nextMessages = [...state.messages, newMessage]
          // Sync to history if we have a project ID
          const nextHistory = { ...state.history }
          if (state.currentProjectId) {
            nextHistory[state.currentProjectId] = nextMessages
          }

          return {
            messages: nextMessages,
            history: nextHistory
          }
        })
        return id
      },

      updateMessage: (id, data) => {
        set((state) => {
          const nextMessages = state.messages.map((msg) =>
            msg.id === id ? { ...msg, ...data } : msg
          )

          // Sync to history
          const nextHistory = { ...state.history }
          if (state.currentProjectId) {
            nextHistory[state.currentProjectId] = nextMessages
          }

          return {
            messages: nextMessages,
            history: nextHistory
          }
        })
      },

      clearMessages: () => set((state) => {
        const nextHistory = { ...state.history }
        if (state.currentProjectId) {
          nextHistory[state.currentProjectId] = []
        }
        return {
          messages: [],
          history: nextHistory
        }
      }),

      setInitialPrompt: (prompt, attachments) => set({ initialPrompt: prompt, initialAttachments: attachments ?? null }),

      clearInitialPrompt: () => set({ initialPrompt: null, initialAttachments: null }),

      setStreaming: (streaming) => set({ isStreaming: streaming }),

      setProjectId: (id) => set({ currentProjectId: id }),

      switchProject: (projectId) => {
        const state = get()
        // If switching to the same project, do nothing
        if (state.currentProjectId === projectId) return

        // Load messages from history for the new project
        const projectMessages = state.history[projectId] || []

        set({
          currentProjectId: projectId,
          messages: projectMessages
        })
      }
    }),
    {
      name: 'ai-draw-nexus-chat-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Persist history and currentProjectId
        // We don't necessarily need to persist 'messages' separately if we restore from history on hydration,
        // but keeping it simple for now. 
        // Actually, let's persist everything to be safe.
        history: state.history,
        currentProjectId: state.currentProjectId,
        // If we reload the page, we want the current messages to be there.
        // If they are synced with history, restoring history + currentProjectId + switch logic (or auto-restore) is enough.
        // But zustand persist restores state 'as is'.
        messages: state.messages
      }),
    }
  )
)
