import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { Model } from '@mariozechner/pi-ai'
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

export function encodePiModelValue(model: PiModelRef): string {
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

function toolResultContentToString(content: AnyContent[]): string {
  return content
    .filter((item: AnyContent) => item.type === 'text')
    .map((item: AnyContent) => String(item.text ?? ''))
    .join('\n')
}

function mapSingleMessage(sessionId: string, msg: AgentMessage, index: number): SessionMessage[] {
  const role = (msg as { role: string }).role
  const ts = messageTimestamp(msg)

  switch (role) {
    case 'user': {
      const um = msg as { content: string | AnyContent[]; timestamp: number }
      return [{
        type: 'user',
        uuid: `pi-${sessionId}-${index}`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
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
        uuid: `pi-${sessionId}-${index}`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
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
        uuid: `pi-${sessionId}-${index}-tool-result`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: tr.toolCallId,
            content: toolResultContentToString(tr.content),
            is_error: tr.isError || undefined,
          }],
        },
      }]
    }
    case 'bashExecution': {
      const be = msg as { role: 'bashExecution'; command: string; output: string; exitCode: number | undefined; cancelled: boolean; truncated: boolean; timestamp: number }
      const output = be.output ? `\n${be.output}` : ''
      const exitLabel = be.exitCode !== undefined ? ` (exit ${be.exitCode})` : ''
      return [{
        type: 'assistant',
        uuid: `pi-${sessionId}-${index}-bash`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: `bash-${index}`,
            name: 'bash',
            input: { command: be.command },
          }],
        },
      }, {
        type: 'user',
        uuid: `pi-${sessionId}-${index}-bash-result`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: `bash-${index}`,
            content: `$ ${be.command}${output}${exitLabel}`,
            is_error: (be.exitCode !== undefined && be.exitCode !== 0) || undefined,
          }],
        },
      }]
    }
    case 'branchSummary': {
      const bs = msg as { role: 'branchSummary'; summary: string; fromId: string; timestamp: number }
      return [{
        type: 'assistant',
        uuid: `pi-${sessionId}-${index}-branch`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
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
        uuid: `pi-${sessionId}-${index}-compaction`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        message: {
          role: 'assistant',
          content: `[Compaction summary — ${cs.tokensBefore.toLocaleString()} tokens before] ${cs.summary}`,
        },
      }]
    }
    case 'custom': {
      const cm = msg as { role: 'custom'; customType: string; content: string | AnyContent[]; display: boolean; timestamp: number }
      if (!cm.display) return []
      const text = typeof cm.content === 'string'
        ? cm.content
        : cm.content.filter((c: AnyContent) => c.type === 'text').map((c: AnyContent) => String(c.text)).join('\n')
      return [{
        type: 'assistant',
        uuid: `pi-${sessionId}-${index}-custom`,
        session_id: sessionId,
        parent_tool_use_id: null,
        provider: 'pi',
        timestamp: ts,
        message: {
          role: 'assistant',
          content: text || `[${cm.customType}]`,
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

export function mapPiModelsToSessionModels(models: Model<any>[], currentModel?: string): SessionModelInfo[] {
  const mapped = models.map((model) => ({
    value: encodePiModelValue({ providerID: model.provider, modelID: model.id }),
    displayName: `${model.provider} · ${model.name}`,
    description: `${model.provider}/${model.id}`,
    supportsEffort: model.reasoning,
    supportedEffortLevels: model.reasoning
      ? ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] satisfies ReasoningEffortLevel[]
      : undefined,
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
