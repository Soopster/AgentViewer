import type {
  ApiMessage,
  ContextUsage,
  Session,
  SessionDiagnosticSection,
  SessionInfo,
  SessionMessage,
  SessionModelInfo,
} from './types'
import type {
  CodexExperimentalFeature,
  CodexFileUpdateChange,
  CodexMcpServerStatus,
  CodexSkillsListResponse,
  CodexThread,
  CodexThreadItem,
  CodexThreadTokenUsage,
  CodexUserInput,
} from './codexProtocol'
import { CODEX_CAPABILITIES } from './provider'
import { buildThreadedMessages, type ThreadedMessage } from './threading'

function isPendingCodexThread(thread: CodexThread): boolean {
  return !thread.path && !thread.preview && (thread.turns?.length ?? 0) === 0
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function msToIsoTimestamp(ms: number | null | undefined): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return undefined
  return new Date(ms).toISOString()
}

function uuidV7ToIsoTimestamp(value: string): string | undefined {
  // Last-resort fallback for records predating Turn.startedAt /
  // {Item,Turn}{Started,Completed}AtMs notification fields. UUID v7
  // encodes a unix-ms timestamp in the first 48 bits.
  const compact = value.replace(/-/g, '')
  if (!/^[0-9a-fA-F]{12,}$/.test(compact)) return undefined
  const milliseconds = Number.parseInt(compact.slice(0, 12), 16)
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return undefined
  return new Date(milliseconds).toISOString()
}

function codexUserInputToText(input: CodexUserInput[]): string {
  return input
    .map((entry) => {
      switch (entry.type) {
        case 'text':
          return entry.text
        case 'image':
          return `[image] ${entry.url}`
        case 'localImage':
          return `[local image] ${entry.path}`
        case 'skill':
          return `[skill] ${entry.name}`
        case 'mention':
          return `[@${entry.name}] ${entry.path}`
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')
}

function makeMessage(
  threadId: string,
  uuid: string,
  type: 'user' | 'assistant',
  content: ApiMessage['content'],
  turnId: string,
  timestamp?: string,
): SessionMessage {
  return {
    type,
    uuid,
    session_id: threadId,
    parent_tool_use_id: null,
    provider: 'codex',
    turnId,
    timestamp,
    message: {
      role: type,
      content,
    },
  }
}

function makeToolResult(toolUseId: string, content: string, isError = false) {
  return {
    type: 'tool_result' as const,
    tool_use_id: toolUseId,
    content,
    is_error: isError || undefined,
  }
}

function summarizeFileChanges(status: string, changes: CodexFileUpdateChange[]): string {
  if (changes.length === 0) return 'No file changes recorded.'

  const noun = `${changes.length} file change${changes.length === 1 ? '' : 's'}`
  if (status === 'failed' || status === 'declined') return `${status} ${noun}`
  if (status === 'inProgress') return `Applying ${noun}`
  return `Applied ${noun}`
}

function toolInput(value: unknown): Record<string, unknown> {
  const objectValue = asObject(value)
  return Object.keys(objectValue).length > 0 ? objectValue : { value }
}

function mapItemToMessages(
  threadId: string,
  turnId: string,
  item: CodexThreadItem,
  timestamp?: string,
  options: { includeToolResults?: boolean } = {},
): SessionMessage[] {
  const baseId = `${turnId}:${item.id}`
  const includeToolResults = options.includeToolResults ?? true

  switch (item.type) {
    case 'userMessage': {
      const text = codexUserInputToText(item.content)
      return text
        ? [makeMessage(threadId, baseId, 'user', text, turnId, timestamp)]
        : []
    }
    case 'agentMessage':
      return item.text ? [makeMessage(threadId, baseId, 'assistant', item.text, turnId, timestamp)] : []
    case 'plan':
      return item.text ? [makeMessage(threadId, baseId, 'assistant', `## Plan\n\n${item.text}`, turnId, timestamp)] : []
    case 'reasoning': {
      const thinking = [...item.summary, ...item.content].filter(Boolean).join('\n\n').trim()
      return thinking
        ? [makeMessage(threadId, baseId, 'assistant', [{ type: 'thinking', thinking }], turnId, timestamp)]
        : []
    }
    case 'commandExecution': {
      const toolUseId = `${baseId}:tool`
      const assistant = makeMessage(threadId, baseId, 'assistant', [{
        type: 'tool_use',
        id: toolUseId,
        name: 'Bash',
        input: {
          command: item.command,
          cwd: item.cwd,
          status: item.status,
          source: item.source,
          processId: item.processId,
        },
      }], turnId, timestamp)
      const resultText = [
        item.aggregatedOutput ?? '',
        item.exitCode != null ? `exit_code: ${item.exitCode}` : '',
        item.durationMs != null ? `duration_ms: ${item.durationMs}` : '',
      ].filter(Boolean).join('\n')
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, resultText || 'No output recorded.', item.status === 'failed'),
      ], turnId, timestamp)
      return includeToolResults ? [assistant, result] : [assistant]
    }
    case 'fileChange': {
      const toolUseId = `${baseId}:tool`
      const assistant = makeMessage(threadId, baseId, 'assistant', [{
        type: 'tool_use',
        id: toolUseId,
        name: 'FileChange',
        input: {
          status: item.status,
          changes: item.changes.map((change) => ({ path: change.path, kind: change.kind, diff: change.diff })),
        },
      }], turnId, timestamp)
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, summarizeFileChanges(item.status, item.changes), item.status === 'failed'),
      ], turnId, timestamp)
      return includeToolResults ? [assistant, result] : [assistant]
    }
    case 'mcpToolCall': {
      const toolUseId = `${baseId}:tool`
      const assistant = makeMessage(threadId, baseId, 'assistant', [{
        type: 'tool_use',
        id: toolUseId,
        name: item.tool || 'MCP',
        input: {
          server: item.server,
          status: item.status,
          ...toolInput(item.arguments),
        },
      }], turnId, timestamp)
      const resultText = item.error
        ? stringify(item.error)
        : item.result
        ? stringify(item.result)
        : `${item.server}/${item.tool} completed with no structured result`
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, resultText, Boolean(item.error)),
      ], turnId, timestamp)
      return includeToolResults ? [assistant, result] : [assistant]
    }
    case 'dynamicToolCall': {
      const toolUseId = `${baseId}:tool`
      const assistant = makeMessage(threadId, baseId, 'assistant', [{
        type: 'tool_use',
        id: toolUseId,
        name: item.tool || 'DynamicTool',
        input: toolInput(item.arguments),
      }], turnId, timestamp)
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, stringify(item.contentItems ?? { success: item.success, status: item.status }), item.success === false),
      ], turnId, timestamp)
      return includeToolResults ? [assistant, result] : [assistant]
    }
    case 'collabAgentToolCall': {
      const toolUseId = `${baseId}:tool`
      const assistant = makeMessage(threadId, baseId, 'assistant', [{
        type: 'tool_use',
        id: toolUseId,
        name: 'Agent',
        input: {
          tool: item.tool,
          status: item.status,
          senderThreadId: item.senderThreadId,
          receiverThreadIds: item.receiverThreadIds,
          prompt: item.prompt,
          model: item.model,
          reasoningEffort: item.reasoningEffort,
        },
      }], turnId, timestamp)
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, stringify(item.agentsStates)),
      ], turnId, timestamp)
      return includeToolResults ? [assistant, result] : [assistant]
    }
    case 'webSearch': {
      const toolUseId = `${baseId}:tool`
      const assistant = makeMessage(threadId, baseId, 'assistant', [{
        type: 'tool_use',
        id: toolUseId,
        name: 'WebSearch',
        input: {
          query: item.query,
          action: item.action,
        },
      }], turnId, timestamp)
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, stringify(item.action ?? { query: item.query })),
      ], turnId, timestamp)
      return includeToolResults ? [assistant, result] : [assistant]
    }
    case 'imageView':
      return [makeMessage(threadId, baseId, 'assistant', `[image view] ${item.path}`, turnId, timestamp)]
    case 'imageGeneration':
      return [makeMessage(threadId, baseId, 'assistant', `Image generation (${item.status})\n\n${item.result}`, turnId, timestamp)]
    case 'enteredReviewMode':
      return [makeMessage(threadId, baseId, 'assistant', `Entered review mode\n\n${item.review}`, turnId, timestamp)]
    case 'exitedReviewMode':
      return [makeMessage(threadId, baseId, 'assistant', `Exited review mode\n\n${item.review}`, turnId, timestamp)]
    case 'contextCompaction':
      return [makeMessage(threadId, baseId, 'assistant', 'Context compaction completed.', turnId, timestamp)]
    case 'hookPrompt':
      return [makeMessage(threadId, baseId, 'assistant', `Hook prompt emitted (${item.fragments.length} fragment${item.fragments.length === 1 ? '' : 's'}).`, turnId, timestamp)]
    default:
      return []
  }
}

export function normalizeCodexStreamThreadedMessage(payload: unknown, fallbackSessionId?: string): ThreadedMessage | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.type !== 'codex_item_completed' && record.type !== 'codex_item_started') return null

  const item = asObject(record.item)
  const itemId = typeof item.id === 'string' ? item.id : null
  const itemType = typeof item.type === 'string' ? item.type : null
  const turnId = typeof record.turnId === 'string'
    ? record.turnId
    : typeof asObject(record.turn).id === 'string'
    ? asObject(record.turn).id as string
    : null
  const threadId = typeof record.threadId === 'string' ? record.threadId : fallbackSessionId ?? null

  if (!itemId || !itemType || !turnId || !threadId) return null

  // ItemStarted/CompletedNotification carry an exact millisecond timestamp;
  // prefer it, then fall back to v7-UUID extraction for any payload that
  // somehow lacks the field.
  const timestampMs = record.type === 'codex_item_completed'
    ? (typeof record.completedAtMs === 'number' ? record.completedAtMs : undefined)
    : (typeof record.startedAtMs === 'number' ? record.startedAtMs : undefined)
  const timestamp = msToIsoTimestamp(timestampMs) ?? uuidV7ToIsoTimestamp(itemId) ?? uuidV7ToIsoTimestamp(turnId)
  const messages = mapItemToMessages(threadId, turnId, item as CodexThreadItem, timestamp, {
    includeToolResults: record.type === 'codex_item_completed',
  })
  if (messages.length === 0) return null

  return buildThreadedMessages(messages).find((message) => message.role === 'assistant') ?? null
}

export function mapCodexThreadToSession(thread: CodexThread, tag: string | null): Session {
  return {
    sessionId: thread.id,
    summary: thread.preview || thread.name || thread.id,
    customTitle: thread.name ?? undefined,
    firstPrompt: thread.preview || undefined,
    lastModified: thread.updatedAt * 1000,
    cwd: thread.cwd,
    tag,
    createdAt: thread.createdAt * 1000,
    provider: 'codex',
    capabilities: CODEX_CAPABILITIES,
    isPending: isPendingCodexThread(thread) ? true : undefined,
  }
}

export function mapCodexThreadToSessionInfo(thread: CodexThread, tag: string | null, currentModel: string | null): SessionInfo {
  return {
    sessionId: thread.id,
    summary: thread.preview || thread.name || thread.id,
    customTitle: thread.name ?? undefined,
    firstPrompt: thread.preview || undefined,
    lastModified: thread.updatedAt * 1000,
    gitBranch: thread.gitInfo?.branch ?? undefined,
    cwd: thread.cwd,
    tag: tag ?? undefined,
    createdAt: thread.createdAt * 1000,
    provider: 'codex',
    capabilities: CODEX_CAPABILITIES,
    currentModel: currentModel ?? undefined,
  }
}

export function mapCodexThreadToMessages(thread: CodexThread): SessionMessage[] {
  const messages: SessionMessage[] = []
  const turns = [...thread.turns]

  for (const turn of turns) {
    // Turn.startedAt is in seconds (per schema). Fall back to v7-UUID
    // extraction for rollouts from older codex versions that didn't
    // persist the field.
    const turnTimestamp = msToIsoTimestamp(turn.startedAt != null ? turn.startedAt * 1000 : undefined)
      ?? uuidV7ToIsoTimestamp(turn.id)
    const items = [...turn.items]
    for (const item of items) {
      // ThreadItem has no per-item timestamp in the archive, so its v7
      // UUID is still the only finer-grained signal we can use; fall
      // back to the turn timestamp if even that doesn't parse.
      const itemTimestamp = uuidV7ToIsoTimestamp(item.id) ?? turnTimestamp
      messages.push(...mapItemToMessages(thread.id, turn.id, item, itemTimestamp))
    }

    if (turn.error) {
      // turn.error is TurnError { message, additionalDetails, codexErrorInfo },
      // not a string — stringifying it directly used to render as
      // "[object Object]".
      const errorText = [turn.error.message, turn.error.additionalDetails ?? ''].filter(Boolean).join('\n\n')
      messages.push(makeMessage(thread.id, `${turn.id}:error`, 'assistant', `Turn failed\n\n${errorText}`, turn.id, turnTimestamp))
    }
  }

  return messages
}

export function mapCodexTokenUsageToContextUsage(tokenUsage: CodexThreadTokenUsage, model: string): ContextUsage {
  // `total` is lifetime thread usage and can exceed the model window many
  // times over. `last` is the current request/context snapshot that Codex
  // itself uses for context-window accounting.
  const context = tokenUsage.last ?? tokenUsage.total ?? null
  const maxTokens = tokenUsage.modelContextWindow ?? 0
  const totalTokens = context?.totalTokens ?? 0

  return {
    totalTokens,
    maxTokens,
    percentage: maxTokens > 0 ? Math.min(100, (totalTokens / maxTokens) * 100) : 0,
    model,
    categories: [
      { name: 'Input', tokens: context?.inputTokens ?? 0, color: 'var(--cyan)' },
      { name: 'Cached', tokens: context?.cachedInputTokens ?? 0, color: 'var(--green)' },
      { name: 'Output', tokens: context?.outputTokens ?? 0, color: 'var(--violet)' },
      { name: 'Reasoning', tokens: context?.reasoningOutputTokens ?? 0, color: 'var(--amber)' },
    ],
  }
}

export function mapCodexModelsToSessionModels(models: Array<{
  model: string
  displayName: string
  description: string
  supportedReasoningEfforts?: Array<string | { reasoningEffort?: string | null }> | null
}>): SessionModelInfo[] {
  const reasoningEfforts = (value: Array<string | { reasoningEffort?: string | null }> | null | undefined) =>
    (value ?? [])
      .map((entry) => typeof entry === 'string' ? entry : entry.reasoningEffort)
      .filter((entry): entry is 'low' | 'medium' | 'high' | 'max' | 'xhigh' =>
        entry === 'low' || entry === 'medium' || entry === 'high' || entry === 'max' || entry === 'xhigh'
      )

  return models.map((model) => ({
    value: model.model,
    displayName: model.displayName || model.model,
    description: model.description || '',
    supportsEffort: reasoningEfforts(model.supportedReasoningEfforts).length > 0,
    supportedEffortLevels: reasoningEfforts(model.supportedReasoningEfforts),
  }))
}

export function mapCodexDiagnosticsToSections(params: {
  thread: CodexThread
  currentModel: string | null
  mcpServers: CodexMcpServerStatus[]
  features: CodexExperimentalFeature[]
  skills: CodexSkillsListResponse['data']
  apps: Array<{ name: string }>
}): SessionDiagnosticSection[] {
  // Thread.status is a discriminated union ({type:'idle'|'active'|...});
  // interpolating it directly used to print "[object Object]".
  const status = params.thread.status
  const statusLabel = status.type === 'active' && status.activeFlags.length > 0
    ? `active(${status.activeFlags.join(',')})`
    : status.type

  const sections: SessionDiagnosticSection[] = [
    {
      id: 'runtime',
      title: 'RUNTIME',
      items: [
        `status · ${statusLabel}`,
        `cwd · ${params.thread.cwd}`,
        `model · ${params.currentModel ?? 'unknown'}`,
        `provider · ${params.thread.modelProvider}`,
        ...(params.thread.gitInfo?.branch ? [`git · ${params.thread.gitInfo.branch}`] : []),
      ],
    },
    {
      id: 'mcp',
      title: 'MCP',
      items: params.mcpServers.length > 0
        ? params.mcpServers.map((server) => `${server.name} · ${server.authStatus ?? 'unknown'}`)
        : ['No MCP servers'],
    },
    {
      id: 'features',
      title: 'FEATURES',
      items: params.features.length > 0
        ? params.features.map((feature) => `${feature.displayName ?? feature.name} · ${feature.enabled ? 'enabled' : 'disabled'}`)
        : ['No experimental features'],
    },
    {
      id: 'skills',
      title: 'SKILLS',
      items: params.skills.flatMap((entry) =>
        entry.skills.map((skill) => skill.name || skill.description || 'Unnamed skill')
      ).slice(0, 20),
    },
    {
      id: 'apps',
      title: 'APPS',
      items: params.apps.length > 0
        ? params.apps.map((app) => app.name)
        : ['No apps'],
    },
  ]

  return sections.map((section) => ({
    ...section,
    items: section.items.length > 0 ? section.items : ['None'],
  }))
}
