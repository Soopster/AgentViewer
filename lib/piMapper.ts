import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Model } from '@earendil-works/pi-ai'
import type {
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import type {
  ContentBlock,
  Session,
  SessionDiagnosticSection,
  SessionInfo,
  SessionMessage,
  SessionModelInfo,
  ReasoningEffortLevel,
} from './types'
import { PI_CAPABILITIES } from './provider'
import type { PiSessionListEntry } from './piClient'

type PiStoredMetadata = {
  title: string | null
  tag: string | null
}

type PiModelRef = {
  providerID: string
  modelID: string
}

function encodePiModelValue(model: PiModelRef): string {
  return JSON.stringify(model)
}

export function decodePiModelValue(value: string | null | undefined): PiModelRef | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<PiModelRef>
    return typeof parsed.providerID === 'string' && typeof parsed.modelID === 'string'
      ? { providerID: parsed.providerID, modelID: parsed.modelID }
      : null
  } catch {
    return null
  }
}

function messageTimestamp(msg: AgentMessage): string | undefined {
  if ('timestamp' in msg && typeof msg.timestamp === 'number') {
    return new Date(msg.timestamp).toISOString()
  }
  return undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContent = any

function userContentToBlocks(content: string | AnyContent[]): string | ContentBlock[] {
  if (typeof content === 'string') return content
  const blocks: ContentBlock[] = []
  for (const item of content) {
    if (item.type === 'text') {
      blocks.push({ type: 'text', text: String(item.text ?? '') })
    } else if (item.type === 'image') {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: item.mimeType, data: item.data },
      })
    }
  }
  return blocks.length > 0 ? blocks : ''
}

function assistantContentToBlocks(content: AnyContent[]): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const item of content) {
    switch (item.type) {
      case 'text':
        blocks.push({ type: 'text', text: String(item.text ?? '') })
        break
      case 'thinking':
        blocks.push({
          type: 'thinking',
          thinking: String(item.thinking ?? ''),
          signature: item.thinkingSignature,
        })
        break
      case 'toolCall':
        blocks.push({
          type: 'tool_use',
          id: item.id,
          name: item.name,
          input: item.arguments ?? {},
        })
        break
      default:
        blocks.push({ type: item.type, ...item })
    }
  }
  return blocks
}

function toolResultContentToBlocks(content: AnyContent[]): string | ContentBlock[] {
  const hasImages = content.some((item: AnyContent) => item.type === 'image')
  if (!hasImages) {
    return content
      .filter((item: AnyContent) => item.type === 'text')
      .map((item: AnyContent) => String(item.text ?? ''))
      .join('\n')
  }
  const blocks: ContentBlock[] = []
  for (const item of content) {
    if (item.type === 'text') {
      blocks.push({ type: 'text', text: String(item.text ?? '') })
    } else if (item.type === 'image') {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: String(item.mimeType ?? ''), data: String(item.data ?? '') },
      })
    }
  }
  return blocks
}

export function piAgentMessageFingerprint(message: AgentMessage): string {
  try {
    return JSON.stringify(message)
  } catch {
    const role = (message as { role?: unknown }).role
    const timestamp = (message as { timestamp?: unknown }).timestamp
    return `${String(role ?? '')}:${String(timestamp ?? '')}`
  }
}

export function piAgentMessageDuplicateKey(message: AgentMessage): string {
  const record = message as unknown as Record<string, unknown>
  const role = typeof record.role === 'string' ? record.role : ''
  if (role === 'bashExecution') {
    // The command alone is not unique: running the same command twice must
    // continue to render live. Ignore only timestamp so the live final result
    // converges with Pi's separately timestamped persisted BashExecutionMessage.
    return `bashExecution:${JSON.stringify([
      record.command,
      record.output,
      record.exitCode,
      record.cancelled,
      record.truncated,
      record.fullOutputPath,
      record.excludeFromContext,
    ])}`
  }
  if (role === 'toolResult') {
    const toolCallId = typeof record.toolCallId === 'string' ? record.toolCallId : ''
    return toolCallId ? `toolResult:${toolCallId}` : piAgentMessageFingerprint(message)
  }
  return piAgentMessageFingerprint(message)
}

function mapSingleMessage(
  sessionId: string,
  msg: AgentMessage,
  index: number,
  providerMessageId?: string,
): SessionMessage[] {
  const role = (msg as { role: string }).role
  const ts = messageTimestamp(msg)
  const uuid = providerMessageId ? `pi-${sessionId}-${providerMessageId}` : `pi-${sessionId}-live-${index}`

  switch (role) {
    case 'user': {
      const um = msg as { content: string | AnyContent[]; timestamp: number }
      return [{
        type: 'user',
        uuid,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        providerMessageId,
        message: {
          role: 'user',
          content: userContentToBlocks(um.content),
        },
      }]
    }
    case 'assistant': {
      const am = msg as {
        content: AnyContent[]
        usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
        model?: string
        errorMessage?: string
      }
      const content = assistantContentToBlocks(am.content)
      return [{
        type: 'assistant',
        uuid,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        providerMessageId,
        message: {
          role: 'assistant',
          content: content.length > 0
            ? content
            : am.errorMessage
            ? `Error: ${am.errorMessage}`
            : '',
          usage: am.usage ? {
            input_tokens: am.usage.input,
            output_tokens: am.usage.output,
            cache_read_input_tokens: am.usage.cacheRead,
            cache_creation_input_tokens: am.usage.cacheWrite,
          } : undefined,
        },
      }]
    }
    case 'toolResult': {
      const tr = msg as {
        toolCallId: string
        toolName: string
        content: AnyContent[]
        isError: boolean
      }
      return [{
        type: 'user',
        uuid: `${uuid}-tool-result`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        providerMessageId,
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: tr.toolCallId,
            content: toolResultContentToBlocks(tr.content),
            is_error: tr.isError || undefined,
          }],
        },
      }]
    }
    case 'bashExecution': {
      const be = msg as { role: 'bashExecution'; command: string; output: string; exitCode: number | undefined; cancelled: boolean; truncated: boolean; fullOutputPath?: string; timestamp: number; excludeFromContext?: boolean }
      const bashToolId = `bash-${providerMessageId ?? index}`
      const output = be.output ? `\n${be.output}` : ''
      const exitLabel = be.cancelled ? ' (cancelled)' : be.exitCode !== undefined ? ` (exit ${be.exitCode})` : ''
      const contextLabel = be.excludeFromContext ? ' [excluded from context]' : ''
      const truncatedNote = be.truncated
        ? `\n[output truncated${be.fullOutputPath ? ` — full output: ${be.fullOutputPath}` : ''}]`
        : ''
      return [{
        type: 'assistant',
        uuid: `${uuid}-bash`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        providerMessageId,
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: bashToolId,
            name: 'bash',
            input: { command: be.command, excludeFromContext: be.excludeFromContext || undefined },
          }],
        },
      }, {
        type: 'user',
        uuid: `${uuid}-bash-result`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        providerMessageId,
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: bashToolId,
            content: `$ ${be.command}${contextLabel}${output}${truncatedNote}${exitLabel}`,
            is_error: be.cancelled || (be.exitCode !== undefined && be.exitCode !== 0) || undefined,
          }],
        },
      }]
    }
    case 'branchSummary': {
      const bs = msg as { role: 'branchSummary'; summary: string; fromId: string; timestamp: number }
      return [{
        type: 'assistant',
        uuid: `${uuid}-branch`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        providerMessageId,
        message: {
          role: 'assistant',
          content: `[Branch summary] ${bs.summary}`,
        },
      }]
    }
    case 'compactionSummary': {
      const cs = msg as { role: 'compactionSummary'; summary: string; tokensBefore: number; timestamp: number }
      return [{
        type: 'assistant',
        uuid: `${uuid}-compaction`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        providerMessageId,
        message: {
          role: 'assistant',
          content: `[Compaction summary — ${cs.tokensBefore.toLocaleString()} tokens before] ${cs.summary}`,
        },
      }]
    }
    case 'custom': {
      const cm = msg as { role: 'custom'; customType: string; content: string | AnyContent[]; display: boolean; timestamp: number }
      if (!cm.display) return []
      const content = userContentToBlocks(cm.content)
      return [{
        type: 'assistant',
        uuid: `${uuid}-custom`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        providerMessageId,
        message: {
          role: 'assistant',
          content: typeof content === 'string' && !content ? `[${cm.customType}]` : content,
        },
      }]
    }
    default:
      return []
  }
}

export function mapPiMessagesToSessionMessages(sessionId: string, messages: AgentMessage[]): SessionMessage[] {
  const result: SessionMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    result.push(...mapSingleMessage(sessionId, messages[i], i))
  }
  return result
}

export function mapPiEntriesToSessionMessages(sessionId: string, entries: readonly SessionEntry[]): SessionMessage[] {
  const result: SessionMessage[] = []
  let messageIndex = 0
  for (const entry of entries) {
    if (entry.type !== 'message') continue
    result.push(...mapSingleMessage(sessionId, entry.message, messageIndex, entry.id))
    messageIndex += 1
  }
  return result
}

export function mapPiSessionToSession(
  info: PiSessionListEntry,
  stored: PiStoredMetadata,
): Session {
  return {
    sessionId: info.id,
    summary: info.name ?? info.firstMessage ?? info.id,
    customTitle: stored.title ?? info.name ?? undefined,
    firstPrompt: info.firstMessage || undefined,
    lastModified: info.modified.getTime(),
    cwd: info.cwd || undefined,
    tag: stored.tag ?? null,
    createdAt: info.created.getTime(),
    provider: 'pi',
    capabilities: PI_CAPABILITIES,
  }
}

export function mapPiSessionToInfo(
  info: PiSessionListEntry,
  stored: PiStoredMetadata,
  messages: AgentMessage[],
  currentModel?: string,
): SessionInfo {
  let firstPrompt: string | undefined
  for (const msg of messages) {
    if ((msg as { role: string }).role === 'user') {
      const content = (msg as { content: string | unknown[] }).content
      firstPrompt = typeof content === 'string'
        ? content.replace(/\s+/g, ' ').trim()
        : undefined
      break
    }
  }

  return {
    sessionId: info.id,
    summary: info.name ?? info.firstMessage ?? info.id,
    customTitle: stored.title ?? info.name ?? undefined,
    firstPrompt: firstPrompt ?? info.firstMessage ?? undefined,
    lastModified: info.modified.getTime(),
    cwd: info.cwd || undefined,
    tag: stored.tag ?? undefined,
    createdAt: info.created.getTime(),
    provider: 'pi',
    capabilities: PI_CAPABILITIES,
    currentModel,
  }
}

export function currentPiModelValue(model?: Model<any> | null, fallbackModel?: string): string | null {
  if (model?.provider && model.id) {
    return encodePiModelValue({ providerID: model.provider, modelID: model.id })
  }
  return fallbackModel ?? null
}

const PI_EFFORT_LEVELS: ReasoningEffortLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function supportedPiEffortLevels(model: Model<any>): ReasoningEffortLevel[] | undefined {
  if (!model.reasoning) return undefined
  return PI_EFFORT_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level]
    if (mapped === null) return false
    // Pi only exposes xhigh/max when the model catalog explicitly maps them.
    return level !== 'xhigh' && level !== 'max' || mapped !== undefined
  })
}

export function mapPiModelsToSessionModels(models: readonly Model<any>[], currentModel?: string): SessionModelInfo[] {
  const mapped = models.map((model) => ({
    value: encodePiModelValue({ providerID: model.provider, modelID: model.id }),
    displayName: `${model.provider} · ${model.name}`,
    description: `${model.provider}/${model.id}`,
    supportsEffort: model.reasoning,
    supportedEffortLevels: supportedPiEffortLevels(model),
  }))

  if (mapped.length > 0) return mapped
  if (!currentModel) return []
  return [{
    value: currentModel,
    displayName: currentModel,
    description: 'Current model',
  }]
}

export function mapPiDiagnosticsToSections(params: {
  sessionId: string
  cwd?: string
  currentModel?: string
  thinkingLevel?: string
  toolNames: string[]
  sessionFile?: string
  stats?: {
    userMessages: number
    assistantMessages: number
    toolCalls: number
    toolResults: number
    totalMessages: number
    cost: number
    tokens: {
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
      total: number
    }
    contextUsage?: {
      tokens?: number | null
      contextWindow?: number | null
      percent?: number | null
    }
  }
}): SessionDiagnosticSection[] {
  const sections: SessionDiagnosticSection[] = [
    {
      id: 'status',
      title: 'STATUS',
      items: [
        `Session ${params.sessionId}`,
        params.cwd ? `CWD ${params.cwd}` : 'CWD unavailable',
        params.sessionFile ? `File ${params.sessionFile}` : 'File unavailable',
      ],
    },
    {
      id: 'model',
      title: 'MODEL',
      items: [
        params.currentModel ? `Current ${params.currentModel}` : 'Current model unavailable',
        params.thinkingLevel ? `Thinking ${params.thinkingLevel}` : 'Thinking level unavailable',
      ],
    },
    {
      id: 'tools',
      title: 'TOOLS',
      items: params.toolNames.length > 0
        ? params.toolNames.slice(0, 20)
        : ['None'],
    },
  ]

  if (params.stats) {
    const context = params.stats.contextUsage
    sections.push({
      id: 'usage',
      title: 'USAGE',
      items: [
        `Messages ${params.stats.totalMessages} · user ${params.stats.userMessages} · assistant ${params.stats.assistantMessages}`,
        `Tools ${params.stats.toolCalls} calls · ${params.stats.toolResults} results`,
        `Tokens ${params.stats.tokens.total.toLocaleString()} · in ${params.stats.tokens.input.toLocaleString()} · out ${params.stats.tokens.output.toLocaleString()}`,
        `Cost $${params.stats.cost.toFixed(4)}`,
        context
          ? `Context ${context.tokens ?? '?'} / ${context.contextWindow ?? '?'}${context.percent == null ? '' : ` · ${Math.round(context.percent)}%`}`
          : 'Context unavailable',
      ],
    })
  }

  return sections
}
