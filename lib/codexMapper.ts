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
): SessionMessage {
  return {
    type,
    uuid,
    session_id: threadId,
    parent_tool_use_id: null,
    provider: 'codex',
    turnId,
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

function summarizeFileChanges(changes: CodexFileUpdateChange[]): string {
  if (changes.length === 0) return 'No file changes recorded.'
  return changes
    .map((change) => `${change.kind}: ${change.path}\n${change.diff}`.trim())
    .join('\n\n')
}

function toolInput(value: unknown): Record<string, unknown> {
  const objectValue = asObject(value)
  return Object.keys(objectValue).length > 0 ? objectValue : { value }
}

function mapItemToMessages(threadId: string, turnId: string, item: CodexThreadItem): SessionMessage[] {
  const baseId = `${turnId}:${item.id}`

  switch (item.type) {
    case 'userMessage': {
      const text = codexUserInputToText(item.content)
      return text
        ? [makeMessage(threadId, baseId, 'user', text, turnId)]
        : []
    }
    case 'agentMessage':
      return item.text ? [makeMessage(threadId, baseId, 'assistant', item.text, turnId)] : []
    case 'plan':
      return item.text ? [makeMessage(threadId, baseId, 'assistant', `## Plan\n\n${item.text}`, turnId)] : []
    case 'reasoning': {
      const thinking = [...item.summary, ...item.content].filter(Boolean).join('\n\n').trim()
      return thinking
        ? [makeMessage(threadId, baseId, 'assistant', [{ type: 'thinking', thinking }], turnId)]
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
      }], turnId)
      const resultText = [
        item.aggregatedOutput ?? '',
        item.exitCode != null ? `exit_code: ${item.exitCode}` : '',
        item.durationMs != null ? `duration_ms: ${item.durationMs}` : '',
      ].filter(Boolean).join('\n')
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, resultText || 'No output recorded.', item.status === 'failed'),
      ], turnId)
      return [assistant, result]
    }
    case 'fileChange': {
      const toolUseId = `${baseId}:tool`
      const assistant = makeMessage(threadId, baseId, 'assistant', [{
        type: 'tool_use',
        id: toolUseId,
        name: 'FileChange',
        input: {
          status: item.status,
          changes: item.changes.map((change) => ({ path: change.path, kind: change.kind })),
        },
      }], turnId)
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, summarizeFileChanges(item.changes), item.status === 'failed'),
      ], turnId)
      return [assistant, result]
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
      }], turnId)
      const resultText = item.error
        ? stringify(item.error)
        : item.result
        ? stringify(item.result)
        : `${item.server}/${item.tool} completed with no structured result`
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, resultText, Boolean(item.error)),
      ], turnId)
      return [assistant, result]
    }
    case 'dynamicToolCall': {
      const toolUseId = `${baseId}:tool`
      const assistant = makeMessage(threadId, baseId, 'assistant', [{
        type: 'tool_use',
        id: toolUseId,
        name: item.tool || 'DynamicTool',
        input: toolInput(item.arguments),
      }], turnId)
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, stringify(item.contentItems ?? { success: item.success, status: item.status }), item.success === false),
      ], turnId)
      return [assistant, result]
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
      }], turnId)
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, stringify(item.agentsStates)),
      ], turnId)
      return [assistant, result]
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
      }], turnId)
      const result = makeMessage(threadId, `${baseId}:result`, 'user', [
        makeToolResult(toolUseId, stringify(item.action ?? { query: item.query })),
      ], turnId)
      return [assistant, result]
    }
    case 'imageView':
      return [makeMessage(threadId, baseId, 'assistant', `[image view] ${item.path}`, turnId)]
    case 'imageGeneration':
      return [makeMessage(threadId, baseId, 'assistant', `Image generation (${item.status})\n\n${item.result}`, turnId)]
    case 'enteredReviewMode':
      return [makeMessage(threadId, baseId, 'assistant', `Entered review mode\n\n${item.review}`, turnId)]
    case 'exitedReviewMode':
      return [makeMessage(threadId, baseId, 'assistant', `Exited review mode\n\n${item.review}`, turnId)]
    case 'contextCompaction':
      return [makeMessage(threadId, baseId, 'assistant', 'Context compaction completed.', turnId)]
    case 'hookPrompt':
      return [makeMessage(threadId, baseId, 'assistant', `Hook prompt emitted (${item.fragments.length} fragment${item.fragments.length === 1 ? '' : 's'}).`, turnId)]
    default:
      return []
  }
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

  for (const turn of thread.turns) {
    for (const item of turn.items) {
      messages.push(...mapItemToMessages(thread.id, turn.id, item))
    }

    if (turn.error) {
      messages.push(makeMessage(thread.id, `${turn.id}:error`, 'assistant', `Turn failed\n\n${turn.error}`, turn.id))
    }
  }

  return messages
}

export function mapCodexTokenUsageToContextUsage(tokenUsage: CodexThreadTokenUsage, model: string): ContextUsage {
  const total = tokenUsage.total ?? {}
  const maxTokens = tokenUsage.modelContextWindow ?? 0
  const totalTokens = total.totalTokens ?? 0

  return {
    totalTokens,
    maxTokens,
    percentage: maxTokens > 0 ? Math.min(100, (totalTokens / maxTokens) * 100) : 0,
    model,
    categories: [
      { name: 'Input', tokens: total.inputTokens ?? 0, color: 'var(--cyan)' },
      { name: 'Cached', tokens: total.cachedInputTokens ?? 0, color: 'var(--green)' },
      { name: 'Output', tokens: total.outputTokens ?? 0, color: 'var(--violet)' },
      { name: 'Reasoning', tokens: total.reasoningOutputTokens ?? 0, color: 'var(--amber)' },
    ],
  }
}

export function mapCodexModelsToSessionModels(models: Array<{
  model: string
  displayName: string
  description: string
  supportedReasoningEfforts?: string[] | null
}>): SessionModelInfo[] {
  return models.map((model) => ({
    value: model.model,
    displayName: model.displayName || model.model,
    description: model.description || '',
    supportsEffort: Array.isArray(model.supportedReasoningEfforts) && model.supportedReasoningEfforts.length > 0,
    supportedEffortLevels: (model.supportedReasoningEfforts ?? []).filter((value): value is 'low' | 'medium' | 'high' | 'max' =>
      value === 'low' || value === 'medium' || value === 'high' || value === 'max'
    ),
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
  const sections: SessionDiagnosticSection[] = [
    {
      id: 'runtime',
      title: 'RUNTIME',
      items: [
        `status · ${params.thread.status}`,
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
