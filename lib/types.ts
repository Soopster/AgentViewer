export type TextBlock = { type: 'text'; text: string }
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string | ContentBlock[]
  is_error?: boolean
}
export type ThinkingBlock = { type: 'thinking'; thinking: string; signature?: string }
export type ImageBlock = {
  type: 'image'
  // Anthropic API format
  source?: { type: 'base64'; media_type: string; data: string }
  // Claude Code / SDK Read-tool format
  file?: {
    base64: string
    type: string
    originalSize?: number
    dimensions?: { originalWidth?: number; originalHeight?: number; displayWidth?: number; displayHeight?: number }
  }
}
export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | ImageBlock
  | { type: string; [key: string]: unknown }

// The inner API message (MessageParam / BetaMessage) stored by Claude Code
export type ApiMessage = {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number | null
    cache_creation_input_tokens?: number | null
  }
}

/**
 * A single entry returned by getSessionMessages().
 * The actual message (role + content) is nested under the `message` field —
 * not at the top level. Only 'user' and 'assistant' types are stored here.
 */
export type SessionMessage = {
  type: 'user' | 'assistant'
  uuid: string
  session_id: string
  message: ApiMessage
  parent_tool_use_id: null
  timestamp?: string
  origin?: { kind: string }
}

export type Session = {
  sessionId: string
  summary?: string
  customTitle?: string
  firstPrompt?: string
  lastModified?: number
  cwd?: string
  tag?: string | null
  createdAt?: string | number
  [key: string]: unknown
}

export type SendState = 'idle' | 'sending' | 'error'

export type ContextUsage = {
  totalTokens: number
  maxTokens: number
  percentage: number
  model: string
  categories: { name: string; tokens: number; color: string }[]
}

export type SessionModelInfo = {
  value: string
  displayName: string
  description: string
  supportsEffort?: boolean
  supportedEffortLevels?: ('low' | 'medium' | 'high' | 'max')[]
}

export type SessionDiagnosticCommand = {
  name: string
  description?: string
}

export type SessionDiagnosticAgent = {
  name: string
  description?: string
}

export type SessionDiagnosticMcpServer = {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  error?: string
}

export type SessionInfo = {
  sessionId: string
  summary: string
  lastModified: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
  tag?: string
  createdAt?: number
}
