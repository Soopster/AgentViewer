import type {
  Agent,
  CommandListResponse,
  ConfigProvidersResponse,
  FileDiff,
  FormatterStatus,
  LspStatus,
  McpStatus,
  Message,
  Part,
  Session as OpenCodeSession,
} from '@opencode-ai/sdk'
import type {
  ApiMessage,
  ContextUsage,
  Session,
  SessionDiagnosticSection,
  SessionInfo,
  SessionMessage,
  SessionModelInfo,
} from './types'
import { compactStableFingerprint } from './compactFingerprint'
import { OPENCODE_CAPABILITIES } from './provider'
import { recordRawFrames } from './rawFrames'

type OpenCodeMessageBundle = {
  info: Message
  parts: Part[]
}

export function openCodeMessagesSignature(messages: OpenCodeMessageBundle[]): string {
  const last = messages.at(-1)
  return `${messages.length}:${last?.info.id ?? ''}:${last ? compactStableFingerprint(last) : ''}`
}

type OpenCodeModelRef = {
  providerID: string
  modelID: string
}

function normalizeTimestamp(value?: number): number | undefined {
  if (!value) return undefined
  return value < 1_000_000_000_000 ? value * 1000 : value
}

function toIsoTimestamp(value?: number): string | undefined {
  const normalized = normalizeTimestamp(value)
  return normalized ? new Date(normalized).toISOString() : undefined
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function textBlock(text: string) {
  return { type: 'text' as const, text }
}

function partSummary(part: Part): string | null {
  switch (part.type) {
    case 'text':
      return part.text
    case 'file':
      return `[file] ${part.filename ?? part.url}`
    case 'agent':
      return `↪ Switched to agent: ${part.name}`
    case 'subtask':
      return `↪ Subtask launched: ${part.description}${part.agent ? ` (@${part.agent})` : ''}`
    case 'patch':
      return `Patched files: ${part.files.join(', ')}`
    case 'compaction':
      return 'Context compaction'
    case 'retry':
      return `Retry ${part.attempt}`
    default:
      return null
  }
}

function buildUserContent(parts: Part[]): ApiMessage['content'] {
  const blocks = parts
    .map(partSummary)
    .filter((text): text is string => Boolean(text))
  return blocks.join('\n\n').trim()
}

function buildAssistantContent(parts: Part[]) {
  const content: Exclude<ApiMessage['content'], string> = []
  const syntheticResults: SessionMessage[] = []

  const pushSyntheticResult = (
    part: Part,
    toolUseId: string,
    resultContent: unknown,
    isError = false,
  ) => {
    syntheticResults.push({
      type: 'user',
      uuid: `${part.messageID}:${part.id}:result`,
      session_id: part.sessionID,
      parent_tool_use_id: null,
      provider: 'opencode',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: stringify(resultContent),
          is_error: isError || undefined,
        }],
      },
      timestamp: toIsoTimestamp((part as { state?: { time?: { start?: number } } }).state?.time?.start),
    })
  }

  for (const part of parts) {
    switch (part.type) {
      case 'text':
        if (part.text.trim()) content.push(textBlock(part.text))
        break
      case 'reasoning':
        if (part.text.trim()) content.push({ type: 'thinking', thinking: part.text })
        break
      case 'tool': {
        const toolUseId = part.callID || part.id
        content.push({
          type: 'tool_use',
          id: toolUseId,
          name: part.tool,
          input: part.state.input ?? {},
        })
        if (part.state.status === 'completed' || part.state.status === 'error') {
          pushSyntheticResult(part, toolUseId, part.state.status === 'completed' ? part.state.output : part.state.error, part.state.status === 'error')
        }
        break
      }
      case 'patch': {
        const toolUseId = `${part.id}:patch`
        content.push({
          type: 'tool_use',
          id: toolUseId,
          name: 'FileChange',
          input: {
            status: 'completed',
            hash: part.hash,
            changes: part.files.map((path) => ({ path, kind: 'patch' })),
          },
        })
        pushSyntheticResult(part, toolUseId, {
          status: 'completed',
          files: part.files,
          hash: part.hash,
        })
        break
      }
      case 'agent': {
        const toolUseId = `${part.id}:agent`
        content.push({
          type: 'tool_use',
          id: toolUseId,
          name: 'AgentSwitch',
          input: {
            name: part.name,
            status: 'completed',
            source: part.source,
          },
        })
        pushSyntheticResult(part, toolUseId, {
          status: 'completed',
          message: `Switched to agent: ${part.name}`,
          source: part.source,
        })
        break
      }
      case 'subtask': {
        const toolUseId = `${part.id}:subtask`
        const optional = part as typeof part & {
          model?: { providerID: string; modelID: string }
          command?: string
        }
        content.push({
          type: 'tool_use',
          id: toolUseId,
          name: 'Agent',
          input: {
            description: part.description,
            prompt: part.prompt,
            subagent_type: part.agent,
            model: optional.model ? `${optional.model.providerID}/${optional.model.modelID}` : undefined,
            command: optional.command,
            status: 'launched',
          },
        })
        pushSyntheticResult(part, toolUseId, {
          status: 'completed',
          message: `Subtask launched: ${part.description}${part.agent ? ` (@${part.agent})` : ''}`,
          agent: part.agent,
          model: optional.model,
          command: optional.command,
        })
        break
      }
      case 'file':
        content.push(textBlock(`[file] ${part.filename ?? part.url}`))
        break
      case 'retry':
        content.push(textBlock(`Retry ${part.attempt}: ${part.error.data.message}`))
        break
      case 'compaction':
        content.push(textBlock('Context compaction completed.'))
        break
      default:
        break
    }
  }

  return {
    content: content.length > 0 ? content : '',
    syntheticResults,
  }
}

function messageUsage(info: Message): ApiMessage['usage'] | undefined {
  if (info.role !== 'assistant') return undefined
  return {
    input_tokens: info.tokens.input,
    output_tokens: info.tokens.output,
    cache_read_input_tokens: info.tokens.cache.read,
    cache_creation_input_tokens: info.tokens.cache.write,
  }
}

function encodeOpenCodeModelValue(model: OpenCodeModelRef): string {
  return JSON.stringify(model)
}

export function decodeOpenCodeModelValue(value: string | null | undefined): OpenCodeModelRef | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<OpenCodeModelRef>
    return typeof parsed.providerID === 'string' && typeof parsed.modelID === 'string'
      ? { providerID: parsed.providerID, modelID: parsed.modelID }
      : null
  } catch {
    return null
  }
}

export function mapOpenCodeSessionToSession(session: OpenCodeSession, tag: string | null, firstPrompt?: string): Session {
  return {
    sessionId: session.id,
    summary: session.title || session.id,
    customTitle: session.title || undefined,
    firstPrompt,
    lastModified: normalizeTimestamp(session.time.updated),
    cwd: session.directory,
    tag,
    createdAt: normalizeTimestamp(session.time.created),
    provider: 'opencode',
    capabilities: OPENCODE_CAPABILITIES,
    parentSessionId: session.parentID,
  }
}

export function mapOpenCodeSessionToInfo(session: OpenCodeSession, tag: string | null, firstPrompt?: string, currentModel?: string): SessionInfo {
  return {
    sessionId: session.id,
    summary: session.title || session.id,
    customTitle: session.title || undefined,
    firstPrompt,
    lastModified: normalizeTimestamp(session.time.updated) ?? Date.now(),
    cwd: session.directory,
    tag: tag ?? undefined,
    createdAt: normalizeTimestamp(session.time.created),
    provider: 'opencode',
    capabilities: OPENCODE_CAPABILITIES,
    currentModel,
    parentSessionId: session.parentID,
  }
}

export function mapOpenCodeMessagesToSessionMessages(messages: OpenCodeMessageBundle[]): SessionMessage[] {
  const result: SessionMessage[] = []

  for (const entry of messages) {
    const timestamp = toIsoTimestamp(entry.info.time.created)
    // Everything produced below came from this one bundle. See lib/rawFrames.ts.
    const startedAt = result.length
    const recordEntry = () => recordRawFrames(result.slice(startedAt), {
      source: 'opencode.sdk.event',
      messageType: entry.info.role,
      payload: entry,
    })

    if (entry.info.role === 'user') {
      result.push({
        type: 'user',
        uuid: entry.info.id,
        session_id: entry.info.sessionID,
        parent_tool_use_id: null,
        provider: 'opencode',
        message: {
          role: 'user',
          content: buildUserContent(entry.parts),
        },
        timestamp,
      })
      recordEntry()
      continue
    }

    const assistant = buildAssistantContent(entry.parts)
    result.push({
      type: 'assistant',
      uuid: entry.info.id,
      session_id: entry.info.sessionID,
      parent_tool_use_id: null,
      provider: 'opencode',
      message: {
        role: 'assistant',
        content: assistant.content || (entry.info.error?.data?.message ? `Error: ${entry.info.error.data.message}` : ''),
        usage: messageUsage(entry.info),
      },
      timestamp,
    })
    result.push(...assistant.syntheticResults)
    recordEntry()
  }

  return result
}

export function mapOpenCodeModelsToSessionModels(config: ConfigProvidersResponse): SessionModelInfo[] {
  const models: SessionModelInfo[] = []
  for (const provider of config.providers) {
    for (const model of Object.values(provider.models)) {
      models.push({
        value: encodeOpenCodeModelValue({ providerID: provider.id, modelID: model.id }),
        displayName: `${provider.name} · ${model.name}`,
        description: `${provider.id}/${model.id}`,
        supportsEffort: Boolean(model.capabilities.reasoning),
      })
    }
  }
  return models
}

export function currentOpenCodeModelValue(message?: Message): string | null {
  if (!message) return null
  if (message.role === 'user') {
    return encodeOpenCodeModelValue(message.model)
  }
  return encodeOpenCodeModelValue({ providerID: message.providerID, modelID: message.modelID })
}

export function firstOpenCodePrompt(messages: OpenCodeMessageBundle[]): string | undefined {
  for (const message of messages) {
    if (message.info.role !== 'user') continue
    for (const part of message.parts) {
      if (part.type === 'text' && part.text.trim()) {
        return part.text.replace(/\s+/g, ' ').trim()
      }
    }
  }
  return undefined
}

export function mapOpenCodeContextUsage(message?: Message): ContextUsage | null {
  if (!message || message.role !== 'assistant') return null
  // Newer OpenCode payloads normalize provider-specific cache semantics into
  // `total`. Prefer it because cached tokens are additive for some providers
  // and already included in input for others.
  const normalizedTotal = (message.tokens as typeof message.tokens & { total?: number }).total
  const totalTokens = normalizedTotal
    ?? message.tokens.input + message.tokens.output + message.tokens.reasoning + message.tokens.cache.read + message.tokens.cache.write
  return {
    totalTokens,
    maxTokens: 0,
    percentage: 0,
    model: encodeOpenCodeModelValue({ providerID: message.providerID, modelID: message.modelID }),
    categories: [
      { name: 'Input', tokens: message.tokens.input, color: 'var(--cyan)' },
      { name: 'Cached Read', tokens: message.tokens.cache.read, color: 'var(--green)' },
      { name: 'Cached Write', tokens: message.tokens.cache.write, color: 'var(--yellow, #fbbf24)' },
      { name: 'Output', tokens: message.tokens.output, color: 'var(--violet)' },
      { name: 'Reasoning', tokens: message.tokens.reasoning, color: 'var(--amber)' },
    ],
  }
}

export function updateOpenCodeTurnOutputUsage(
  outputByMessageId: Map<string, number>,
  message: Message,
  currentTotal: number,
): number {
  if (message.role !== 'assistant') return currentTotal
  const nextOutput = Math.max(0, message.tokens.output)
  const previousOutput = outputByMessageId.get(message.id) ?? 0
  outputByMessageId.set(message.id, nextOutput)
  return Math.max(0, currentTotal - previousOutput + nextOutput)
}

export function mapOpenCodeDiagnosticsToSections(params: {
  providers: ConfigProvidersResponse
  commands: CommandListResponse
  agents: Agent[]
  lsp: LspStatus[]
  formatters: FormatterStatus[]
  mcp: Record<string, McpStatus>
  children?: OpenCodeSession[]
  currentSession?: OpenCodeSession
}): SessionDiagnosticSection[] {
  const connectedProviders = params.providers.providers.map((provider) =>
    `${provider.id} · default ${params.providers.default[provider.id] ?? 'none'}`
  )

  const mcpItems = Object.entries(params.mcp).map(([name, status]) =>
    `${name} · ${status.status}${'error' in status && status.error ? ` · ${status.error}` : ''}`
  )

  const sections: SessionDiagnosticSection[] = [
    {
      id: 'providers',
      title: 'PROVIDERS',
      items: connectedProviders.length > 0 ? connectedProviders : ['None'],
    },
    {
      id: 'commands',
      title: 'COMMANDS',
      items: params.commands.length > 0 ? params.commands.map((command) => command.name) : ['None'],
    },
    {
      id: 'agents',
      title: 'AGENTS',
      items: params.agents.length > 0 ? params.agents.map((agent) => agent.name) : ['None'],
    },
    {
      id: 'lsp',
      title: 'LSP',
      items: params.lsp.length > 0 ? params.lsp.map((entry) => `${entry.name} · ${entry.status}`) : ['None'],
    },
    {
      id: 'formatters',
      title: 'FORMATTERS',
      items: params.formatters.length > 0 ? params.formatters.map((entry) => `${entry.name} · ${entry.enabled ? 'enabled' : 'disabled'}`) : ['None'],
    },
    {
      id: 'mcp',
      title: 'MCP',
      items: mcpItems.length > 0 ? mcpItems : ['None'],
    },
  ]

  sections.push({
    id: 'session',
    title: 'SESSION',
    items: [
      params.currentSession?.share?.url ? `Share ${params.currentSession.share.url}` : 'Share not active',
      params.children && params.children.length > 0
        ? `Children ${params.children.length}: ${params.children.slice(0, 5).map((child) => child.id).join(', ')}`
        : 'Children none',
    ],
  })

  return sections
}

export function summarizeOpenCodeDiffs(diffs: FileDiff[]): string[] {
  return diffs.map((diff) => diff.file)
}
