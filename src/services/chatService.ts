import type { ChatMessage } from '@/types'
import { useAuthStore } from '@/stores/authStore'

const getAuthHeaders = (): Record<string, string> => {
  const token = useAuthStore.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

interface CloudChatMessage {
  id: string
  project_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  attachments: string
  status: 'pending' | 'streaming' | 'complete' | 'error'
  created_at: string
}

function toChatMessage(raw: CloudChatMessage): ChatMessage {
  let attachments: ChatMessage['attachments']
  try {
    attachments = JSON.parse(raw.attachments)
  } catch {
    attachments = undefined
  }
  return {
    id: raw.id,
    role: raw.role === 'system' ? 'assistant' : raw.role,
    content: raw.content,
    status: raw.status,
    timestamp: new Date(raw.created_at),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  }
}

export const ChatService = {
  /**
   * Load the persisted conversation for a project (server-side, account-scoped)
   */
  async getHistory(projectId: string): Promise<ChatMessage[]> {
    const res = await fetch(`/api/chat/history?project_id=${projectId}`, {
      headers: getAuthHeaders()
    })
    if (!res.ok) return []
    const data = await res.json() as CloudChatMessage[]
    return data.map(toChatMessage)
  },

  /**
   * Persist a message (create). Idempotent when an id is supplied.
   */
  async createMessage(message: {
    id?: string
    projectId: string
    role: 'user' | 'assistant' | 'system'
    content: string
    status?: 'pending' | 'streaming' | 'complete' | 'error'
    attachments?: ChatMessage['attachments']
  }): Promise<void> {
    const res = await fetch('/api/chat/history', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id: message.id,
        project_id: message.projectId,
        role: message.role,
        content: message.content,
        status: message.status,
        attachments: message.attachments
      })
    })
    if (!res.ok) {
      console.error('Failed to persist chat message', await res.text().catch(() => ''))
    }
  },

  /**
   * Update a persisted message (content/status)
   */
  async updateMessage(
    id: string,
    data: { content?: string; status?: 'pending' | 'streaming' | 'complete' | 'error'; attachments?: ChatMessage['attachments'] }
  ): Promise<void> {
    const res = await fetch(`/api/chat/history/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    })
    if (!res.ok) {
      console.error('Failed to update chat message', await res.text().catch(() => ''))
    }
  },

  /**
   * Clear the persisted conversation for a project
   */
  async clearHistory(projectId: string): Promise<void> {
    const res = await fetch(`/api/chat/history?project_id=${projectId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
    if (!res.ok) {
      console.error('Failed to clear chat history', await res.text().catch(() => ''))
    }
  },
}
