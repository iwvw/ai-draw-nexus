import type { ChatMessage } from '@/types'
import { getAuthHeaders, apiUrl } from '@/lib/api'

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
    const res = await fetch(apiUrl(`/chat/history?project_id=${projectId}`), {
      headers: getAuthHeaders()
    })
    if (!res.ok) return []
    const data = await res.json() as CloudChatMessage[]
    return data.map(toChatMessage)
  },

  /**
   * Clear the persisted conversation for a project
   */
  async clearHistory(projectId: string): Promise<void> {
    const res = await fetch(apiUrl(`/chat/history?project_id=${projectId}`), {
      method: 'DELETE',
      headers: getAuthHeaders()
    })
    if (!res.ok) {
      console.error('Failed to clear chat history', await res.text().catch(() => ''))
    }
  },
}
