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

export type SystemMessagePayload = {
  type: 'system'
  subtype: string
  content?: string
  level?: string
  [key: string]: unknown
}

export type AgentProvider = 'claude' | 'codex' | 'opencode' | 'copilot' | 'pi'
export type ProviderSelection = AgentProvider | 'all'
export type ReasoningEffortLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'

export type SessionCapabilities = {
  messageFork: boolean
  resumeAtMessage: boolean
  fileRewind: boolean
  rollback: boolean
  deleteSession: boolean
  shareSession: boolean
  unshareSession: boolean
  summarizeSession: boolean
  unrevertSession: boolean
  respondToPermission: boolean
}

/**
 * A single entry returned by getSessionMessages().
 * The actual provider payload is nested under the `message` field rather than
 * living at the top level. Claude history can also include `system` entries.
 */
export type SessionMessage = {
  type: 'user' | 'assistant' | 'system'
  uuid: string
  session_id: string
  message: ApiMessage | SystemMessagePayload
  parent_tool_use_id: null
  timestamp?: string
  origin?: { kind: string }
  provider?: AgentProvider
  turnId?: string
  taskDescription?: string
  requestId?: string
  /**
   * True when Agent Viewer is surfacing an in-memory live overlay before the
   * provider has flushed the message into its durable session history.
   */
  ephemeral?: boolean
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
  provider?: AgentProvider
  capabilities?: SessionCapabilities
  /**
   * When this session was spawned as a subagent by another session, the id of
   * the parent. OpenCode subagents (spawned by the `task` tool) populate this
   * from the SDK's `Session.parentID`.
   */
  parentSessionId?: string
  /**
   * Client-only flag set when the session was just created via /api/sessions/new
   * and the underlying provider has not materialized the transcript yet. The first
   * send carries isPendingSession so provider backends can skip resume/read paths
   * that are unavailable before the first user message.
   */
  isPending?: boolean
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
  supportedEffortLevels?: ReasoningEffortLevel[]
}

export type SessionComposerAgentOption = {
  value: string
  label: string
  description?: string
  mode?: string
  native?: boolean
}

export type SessionComposerModeOption = {
  value: string
  label: string
  description?: string
}

export type SessionComposerOptions = {
  agents?: SessionComposerAgentOption[]
  mentionAgents?: SessionComposerAgentOption[]
  currentAgent?: string | null
  modes?: SessionComposerModeOption[]
  currentMode?: string | null
}

export type SendAttachment = {
  id?: string
  type: 'file' | 'directory' | 'selection' | 'image' | 'mention' | 'skill' | 'blob' | 'agent'
  path?: string
  filePath?: string
  displayName?: string
  text?: string
  data?: string
  mimeType?: string
  selection?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
}

export type SessionDiagnosticSection = {
  id: string
  title: string
  items: string[]
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
  provider: AgentProvider
  capabilities: SessionCapabilities
  currentModel?: string
  parentSessionId?: string
}

export type RunningSessionRef = {
  sessionId: string
  provider: AgentProvider
}
