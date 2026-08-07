// Engine Types
export type EngineType = 'mermaid' | 'excalidraw' | 'drawio'

// Template
export type TemplateType = 'prompt' | 'skeleton'
export type TemplateScope = 'system' | 'workspace' | 'private'

export interface DiagramTemplate {
  id: string
  code: string // 稳定编号，如 T01
  name: string
  description: string
  type: TemplateType
  engineType: EngineType
  scope: TemplateScope
  content: string
  ownerId: string | null
  createdAt: Date
  updatedAt: Date
}

// Project
export interface Project {
  id: string
  title: string
  engineType: EngineType
  thumbnail: string // Base64 string for preview
  createdAt: Date
  updatedAt: Date
}

// Version History
export interface VersionHistory {
  id: string
  projectId: string
  content: string // Source Code / JSON / XML
  changeSummary: string // "Initial" | "AI Edit" | "Manual"
  timestamp: Date
}

// Attachment types for chat messages
export interface ImageAttachment {
  type: 'image'
  dataUrl: string // Base64 data URL
  fileName: string
}

export interface DocumentAttachment {
  type: 'document'
  content: string // Extracted text content
  fileName: string
}

export interface UrlAttachment {
  type: 'url'
  content: string // Extracted markdown content
  url: string
  title: string
}

export type Attachment = ImageAttachment | DocumentAttachment | UrlAttachment

// Chat Message (UI Content Store)
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  status: 'pending' | 'streaming' | 'complete' | 'error'
  avatar?: string
  attachments?: Attachment[]
}

// Payload Message (Message Payload Store - OpenAI compatible)
export interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
  }
}

export interface PayloadMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

// API Request
export interface ChatRequest {
  messages: PayloadMessage[]
  stream?: boolean
}
