import type {
  GetAuthStatusResponse,
  GetStatusResponse,
  ModelInfo,
  SessionContext,
  SessionEvent,
  SessionMetadata,
} from '@github/copilot-sdk'
import type {
  ApiMessage,
  ContentBlock,
  ContextUsage,
  Session,
  SessionDiagnosticSection,
  SessionInfo,
  SessionMessage,
  SessionModelInfo,
} from './types'
import { COPILOT_CAPABILITIES } from './provider'

type CopilotStoredMetadata = {
  title: string | null
  tag: string | null
}

type CopilotDerivedState = {
  firstPrompt?: string
  currentModel?: string
  nativeTitle?: string
  cwd?: string
  gitBranch?: string
  createdAt?: number
  lastModified?: number
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function attachmentLabel(attachment: Record<string, unknown>): string | null {
  const type = typeof attachment.type === 'string' ? attachment.type : ''
  switch (type) {
    case 'file':
      return `[file] ${typeof attachment.displayName === 'string' ? attachment.displayName : String(attachment.path ?? 'file')}`
    case 'directory':
      return `[directory] ${typeof attachment.displayName === 'string' ? attachment.displayName : String(attachment.path ?? 'directory')}`
    case 'selection':
      return `[selection] ${typeof attachment.displayName === 'string' ? attachment.displayName : String(attachment.filePath ?? 'selection')}`
    case 'github_reference':
      return `[github] ${typeof attachment.title === 'string' ? attachment.title : String(attachment.url ?? 'reference')}`
    case 'blob':
      return `[blob] ${typeof attachment.displayName === 'string' ? attachment.displayName : 'attachment'}`
    default:
      return null
  }
}

function userMessageContent(event: Extract<SessionEvent, { type: 'user.message' }>): string {
  const parts = [event.data.content]
  for (const attachment of event.data.attachments ?? []) {
    const label = attachmentLabel(attachment as Record<string, unknown>)
    if (label) parts.push(label)
  }
  return parts.filter(Boolean).join('\n\n').trim()
}

function assistantMessageContent(event: Extract<SessionEvent, { type: 'assistant.message' }>): ApiMessage['content'] {
  const blocks: ContentBlock[] = []

  if (event.data.reasoningText?.trim()) {
    blocks.push({ type: 'thinking', thinking: event.data.reasoningText })
  }

  if (event.data.content.trim()) {
    blocks.push({ type: 'text', text: event.data.content })
  }

  for (const toolRequest of event.data.toolRequests ?? []) {
    blocks.push({
      type: 'tool_use',
      id: toolRequest.toolCallId,
      name: toolRequest.name,
      input: toolRequest.arguments ?? {},
    })
  }

  if (blocks.length === 0) return ''
  if (blocks.length === 1) {
    const onlyBlock = blocks[0]
    if (onlyBlock?.type === 'text') {
      return typeof onlyBlock.text === 'string' ? onlyBlock.text : ''
    }
  }
  return blocks
}

function toolResultContent(event: Extract<SessionEvent, { type: 'tool.execution_complete' }>): string {
  return event.data.result?.detailedContent
    ?? event.data.result?.content
    ?? event.data.error?.message
    ?? (event.data.success ? 'Tool completed.' : 'Tool failed.')
}

function usageFromCopilotEvent(event: Extract<SessionEvent, { type: 'assistant.usage' }>): NonNullable<ApiMessage['usage']> {
  return {
    input_tokens: event.data.inputTokens ?? 0,
    output_tokens: event.data.outputTokens ?? 0,
    cache_read_input_tokens: event.data.cacheReadTokens ?? 0,
    cache_creation_input_tokens: event.data.cacheWriteTokens ?? 0,
  }
}

function mergeUsage(
  left: ApiMessage['usage'] | undefined,
  right: ApiMessage['usage'] | undefined,
): ApiMessage['usage'] | undefined {
  if (!left) return right
  if (!right) return left
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    cache_read_input_tokens: (left.cache_read_input_tokens ?? 0) + (right.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: (left.cache_creation_input_tokens ?? 0) + (right.cache_creation_input_tokens ?? 0),
  }
}

function sessionContextFromEvents(events: SessionEvent[]): SessionContext | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type === 'session.resume' && event.data.context) return event.data.context
    if (event.type === 'session.start' && event.data.context) return event.data.context
  }
  return undefined
}

export function deriveCopilotState(events: SessionEvent[], metadata?: SessionMetadata | null): CopilotDerivedState {
  const derived: CopilotDerivedState = {
    createdAt: metadata?.startTime ? metadata.startTime.getTime() : undefined,
    lastModified: metadata?.modifiedTime ? metadata.modifiedTime.getTime() : undefined,
  }

  for (const event of events) {
    const timestamp = parseTimestamp(event.timestamp)
    if (timestamp) {
      derived.lastModified = Math.max(derived.lastModified ?? 0, timestamp)
    }

    switch (event.type) {
      case 'session.start':
        derived.createdAt ??= parseTimestamp(event.data.startTime) ?? timestamp
        derived.cwd = event.data.context?.cwd ?? derived.cwd
        derived.gitBranch = event.data.context?.branch ?? derived.gitBranch
        derived.currentModel = event.data.selectedModel ?? derived.currentModel
        break
      case 'session.resume':
        derived.cwd = event.data.context?.cwd ?? derived.cwd
        derived.gitBranch = event.data.context?.branch ?? derived.gitBranch
        derived.currentModel = event.data.selectedModel ?? derived.currentModel
        break
      case 'session.title_changed':
        derived.nativeTitle = event.data.title
        break
      case 'session.model_change':
        derived.currentModel = event.data.newModel
        break
      case 'assistant.usage':
        derived.currentModel = event.data.model || derived.currentModel
        break
      case 'user.message':
        if (!derived.firstPrompt) {
          const content = compactText(userMessageContent(event))
          if (content) derived.firstPrompt = content
        }
        break
      default:
        break
    }
  }

  const context = sessionContextFromEvents(events)
  derived.cwd = derived.cwd ?? context?.cwd
  derived.gitBranch = derived.gitBranch ?? context?.branch
  return derived
}

export function mapCopilotSessionToSession(
  metadata: SessionMetadata,
  stored: CopilotStoredMetadata,
): Session {
  return {
    sessionId: metadata.sessionId,
    summary: metadata.summary ?? metadata.sessionId,
    customTitle: stored.title ?? undefined,
    lastModified: metadata.modifiedTime.getTime(),
    cwd: metadata.context?.cwd,
    tag: stored.tag ?? null,
    createdAt: metadata.startTime.getTime(),
    provider: 'copilot',
    capabilities: COPILOT_CAPABILITIES,
  }
}

export function mapCopilotSessionToInfo(
  sessionId: string,
  events: SessionEvent[],
  stored: CopilotStoredMetadata,
  metadata?: SessionMetadata | null,
  currentModel?: string,
): SessionInfo {
  const derived = deriveCopilotState(events, metadata)
  const summary = metadata?.summary ?? derived.nativeTitle ?? derived.firstPrompt ?? sessionId

  return {
    sessionId,
    summary,
    customTitle: stored.title ?? derived.nativeTitle ?? undefined,
    firstPrompt: derived.firstPrompt,
    lastModified: derived.lastModified ?? Date.now(),
    gitBranch: derived.gitBranch,
    cwd: derived.cwd,
    tag: stored.tag ?? undefined,
    createdAt: derived.createdAt,
    provider: 'copilot',
    capabilities: COPILOT_CAPABILITIES,
    currentModel: currentModel ?? derived.currentModel,
  }
}

export function mapCopilotEventsToSessionMessages(sessionId: string, events: SessionEvent[]): SessionMessage[] {
  const messages: SessionMessage[] = []
  let currentTurnId: string | undefined
  const lastAssistantMessageIndexByTurn = new Map<string, number>()
  const pendingUsageByTurn = new Map<string, NonNullable<ApiMessage['usage']>>()

  for (const event of events) {
    switch (event.type) {
      case 'assistant.turn_start':
        currentTurnId = event.data.turnId
        break
      case 'assistant.turn_end':
        if (currentTurnId === event.data.turnId) currentTurnId = undefined
        break
      case 'user.message':
        messages.push({
          type: 'user',
          uuid: event.id,
          session_id: sessionId,
          parent_tool_use_id: null,
          provider: 'copilot',
          turnId: currentTurnId,
          origin: event.data.source ? { kind: event.data.source } : undefined,
          timestamp: event.timestamp,
          message: {
            role: 'user',
            content: userMessageContent(event),
          },
        })
        break
      case 'assistant.reasoning':
        messages.push({
          type: 'assistant',
          uuid: event.data.reasoningId,
          session_id: sessionId,
          parent_tool_use_id: null,
          provider: 'copilot',
          turnId: currentTurnId,
          timestamp: event.timestamp,
          message: {
            role: 'assistant',
            content: [{ type: 'thinking', thinking: event.data.content }],
          },
        })
        break
      case 'assistant.message':
        messages.push({
          type: 'assistant',
          uuid: event.data.messageId,
          session_id: sessionId,
          parent_tool_use_id: null,
          provider: 'copilot',
          turnId: currentTurnId,
          timestamp: event.timestamp,
          message: {
            role: 'assistant',
            content: assistantMessageContent(event),
          },
        })
        if (currentTurnId) {
          const index = messages.length - 1
          lastAssistantMessageIndexByTurn.set(currentTurnId, index)
          const pendingUsage = pendingUsageByTurn.get(currentTurnId)
          if (pendingUsage) {
            ;(messages[index].message as ApiMessage).usage = pendingUsage
            pendingUsageByTurn.delete(currentTurnId)
          }
        }
        break
      case 'assistant.usage': {
        if (!currentTurnId) break
        const usage = mergeUsage(pendingUsageByTurn.get(currentTurnId), usageFromCopilotEvent(event))
        const assistantIndex = lastAssistantMessageIndexByTurn.get(currentTurnId)
        if (assistantIndex != null) {
          const message = messages[assistantIndex]
          if (message?.type === 'assistant') {
            ;(message.message as ApiMessage).usage = mergeUsage((message.message as ApiMessage).usage, usage)
          }
        } else if (usage) {
          pendingUsageByTurn.set(currentTurnId, usage as NonNullable<ApiMessage['usage']>)
        }
        break
      }
      case 'tool.execution_complete':
        messages.push({
          type: 'user',
          uuid: `${event.id}:tool-result`,
          session_id: sessionId,
          parent_tool_use_id: null,
          provider: 'copilot',
          turnId: currentTurnId,
          timestamp: event.timestamp,
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: event.data.toolCallId,
              content: toolResultContent(event),
              is_error: event.data.success ? undefined : true,
            }],
          },
        })
        break
      case 'session.error':
        messages.push({
          type: 'assistant',
          uuid: event.id,
          session_id: sessionId,
          parent_tool_use_id: null,
          provider: 'copilot',
          turnId: currentTurnId,
          timestamp: event.timestamp,
          message: {
            role: 'assistant',
            content: `Error: ${event.data.message}`,
          },
        })
        break
      default:
        break
    }
  }

  return messages
}

export function mapCopilotModelsToSessionModels(models: ModelInfo[]): SessionModelInfo[] {
  return models.map((model) => ({
    value: model.id,
    displayName: model.name,
    description: `Context ${model.capabilities.limits.max_context_window_tokens.toLocaleString()} tokens`,
    supportsEffort: model.capabilities.supports.reasoningEffort,
    supportedEffortLevels: model.supportedReasoningEfforts,
  }))
}

export function mapCopilotUsageToContextUsage(
  event: Extract<SessionEvent, { type: 'assistant.usage' }>,
  models: Map<string, ModelInfo>,
): ContextUsage {
  const inputTokens = event.data.inputTokens ?? 0
  const outputTokens = event.data.outputTokens ?? 0
  const cacheReadTokens = event.data.cacheReadTokens ?? 0
  const cacheWriteTokens = event.data.cacheWriteTokens ?? 0
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  const maxTokens = models.get(event.data.model)?.capabilities.limits.max_context_window_tokens ?? Math.max(totalTokens, 1)

  return {
    totalTokens,
    maxTokens,
    percentage: maxTokens > 0 ? (totalTokens / maxTokens) * 100 : 0,
    model: event.data.model,
    categories: [
      inputTokens > 0 ? { name: 'input', tokens: inputTokens, color: 'var(--cyan)' } : null,
      outputTokens > 0 ? { name: 'output', tokens: outputTokens, color: 'var(--green)' } : null,
      cacheReadTokens > 0 ? { name: 'cache read', tokens: cacheReadTokens, color: 'var(--amber)' } : null,
      cacheWriteTokens > 0 ? { name: 'cache write', tokens: cacheWriteTokens, color: 'var(--violet)' } : null,
    ].filter((value): value is ContextUsage['categories'][number] => Boolean(value)),
  }
}

export function mapCopilotDiagnosticsToSections(params: {
  sessionId: string
  status: GetStatusResponse
  auth: GetAuthStatusResponse
  currentModel: string | null
  mode: string | null
  tools: Array<{ name: string; description?: string }>
  quotaItems: string[]
  metadata?: SessionMetadata | null
  events: SessionEvent[]
  workspacePath?: string
}): SessionDiagnosticSection[] {
  const derived = deriveCopilotState(params.events, params.metadata)

  return [
    {
      id: 'status',
      title: 'STATUS',
      items: [
        `Session ${params.sessionId}`,
        `Copilot ${params.status.version} · protocol ${params.status.protocolVersion}`,
        derived.cwd ? `CWD ${derived.cwd}` : 'CWD unavailable',
        derived.gitBranch ? `Branch ${derived.gitBranch}` : 'Branch unavailable',
        params.workspacePath ? `Workspace ${params.workspacePath}` : 'Workspace unavailable',
      ],
    },
    {
      id: 'auth',
      title: 'AUTH',
      items: params.auth.isAuthenticated
        ? [
            params.auth.login ? `Authenticated as ${params.auth.login}` : 'Authenticated',
            params.auth.authType ? `Auth type ${params.auth.authType}` : 'Auth type unavailable',
            params.auth.host ? `Host ${params.auth.host}` : 'Host unavailable',
            params.auth.statusMessage ?? 'Ready',
          ]
        : [params.auth.statusMessage ?? 'Not authenticated'],
    },
    {
      id: 'model',
      title: 'MODEL',
      items: [
        params.currentModel ? `Current ${params.currentModel}` : 'Current model unavailable',
        params.mode ? `Mode ${params.mode}` : 'Mode unavailable',
        params.metadata?.summary ? `Summary ${params.metadata.summary}` : 'Summary unavailable',
      ],
    },
    {
      id: 'tools',
      title: 'TOOLS',
      items: params.tools.length > 0
        ? params.tools.slice(0, 20).map((tool) => tool.description ? `${tool.name} · ${tool.description}` : tool.name)
        : ['None'],
    },
    {
      id: 'quota',
      title: 'QUOTA',
      items: params.quotaItems.length > 0 ? params.quotaItems : ['Unavailable'],
    },
  ]
}
