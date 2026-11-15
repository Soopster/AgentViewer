// Plugin tool cards on the read path. A transcript window is annotated with each
// plugin's presentation of its tool calls (ToolUseBlock.pluginCard) before it is
// returned, so the Web and the TUI — and a mod's server-side hook — share one
// answer, drawn by each renderer's generic plugin card.
//
// Reads run on every poll, so answers are cached per tool call (a call's input
// does not change once made) and nothing runs while no enabled plugin presents
// tool cards. Messages are copied before annotation: the transcript cache
// shares its objects with every reader.
import { subscribePluginEnablement } from './enablement'
import { hasNativeToolCard } from './nativeTools'
import { hasPluginRuntimeObservers, publishPluginRuntimeEvent } from './runtimeEvents'
import { PLUGIN_TOOL_RESULT_MAX_CHARS, PLUGIN_TRANSCRIPT_PAYLOAD_MAX_CHARS, type PluginToolCardContext } from './behavior'
import type { AgentProvider, ContentBlock, PluginToolCard, SessionMessage, SystemMessagePayload, ToolResultBlock, ToolUseBlock } from '../types'

const CACHE_MAX = 4_000
const cache = new Map<string, PluginToolCard | null>()
// A plugin turned off or on changes what a call reads as.
subscribePluginEnablement(() => { cache.clear(); reportedShapes.clear() })

type ToolResult = NonNullable<PluginToolCardContext['result']>

/** The text of each tool result in a window, by call id, bounded: a hook sees what a person would read, not a transcript's worth of output. */
function collectToolResults(messages: SessionMessage[]): Map<string, ToolResult> {
  const results = new Map<string, ToolResult>()
  for (const message of messages) {
    const content = (message.message as { content?: unknown })?.content
    if (!Array.isArray(content)) continue
    for (const block of content as ContentBlock[]) {
      if (block?.type !== 'tool_result') continue
      const result = block as ToolResultBlock
      const full = typeof result.content === 'string' ? result.content : Array.isArray(result.content) ? result.content.map(part => (part as { type?: string; text?: unknown })?.type === 'text' ? String((part as { text?: unknown }).text ?? '') : '').join('\n') : ''
      results.set(result.tool_use_id, { text: full.slice(0, PLUGIN_TOOL_RESULT_MAX_CHARS), isError: result.is_error === true, truncated: full.length > PLUGIN_TOOL_RESULT_MAX_CHARS })
    }
  }
  return results
}

const reportedShapes = new Set<string>()
const REPORTED_SHAPES_MAX = 2_000
/**
 * Report, once per shape per process, a call that nothing but a generic card
 * draws. Shape is the tool and its input key *names* (never values): the event
 * stream is metadata by contract, and samples are a separate, explicit read.
 */
function noteUnrendered(target: { provider: AgentProvider; providerInstanceId?: string; sessionId: string }, tool: ToolUseBlock, result: ToolResult | undefined): void {
  if (!hasPluginRuntimeObservers() || hasNativeToolCard(tool.name)) return
  const inputKeys = Object.keys(tool.input ?? {}).filter(key => /^[A-Za-z0-9_-]{1,64}$/.test(key)).sort().slice(0, 24)
  const key = `${tool.name}|${inputKeys.join(',')}`
  if (reportedShapes.has(key)) return
  if (reportedShapes.size >= REPORTED_SHAPES_MAX) reportedShapes.delete(reportedShapes.values().next().value!)
  reportedShapes.add(key)
  const server = /^mcp__(.+?)__.+$/.exec(tool.name)?.[1]
  publishPluginRuntimeEvent({ type: 'block.unrendered', target, source: 'read-path', shape: { tool: tool.name.slice(0, 200), ...(server ? { mcpServer: server } : {}), inputKeys, ...(result ? { resultBytes: result.text.length } : {}) } })
}

/** Forget which shapes were reported (a plugin turned on later should hear about them). */
export function clearReportedUnrenderedShapes(): void { reportedShapes.clear() }

/** A system payload reduced to what a hook should see: primitives and short strings, never a transcript's worth. */
function boundSystemPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload).slice(0, 40)) {
    if (key === 'pluginCard') continue
    out[key] = typeof value === 'string' ? value.slice(0, 1_000) : typeof value === 'number' || typeof value === 'boolean' || value === null ? value : value === undefined ? undefined : JSON.stringify(value).slice(0, 500)
  }
  return JSON.stringify(out).length > PLUGIN_TRANSCRIPT_PAYLOAD_MAX_CHARS ? Object.fromEntries(Object.entries(out).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 200) : value])) : out
}

export async function annotatePluginToolCards(provider: AgentProvider, providerInstanceId: string | undefined, sessionId: string, messages: SessionMessage[]): Promise<SessionMessage[]> {
  const { pluginBehaviorHost } = await import('./serverBehaviors')
  const host = pluginBehaviorHost()
  const tools = host.presentsToolCards(), systems = host.presentsTranscriptCards()
  if (!tools && !systems) return messages
  const target = { provider, sessionId, ...(providerInstanceId ? { providerInstanceId } : {}) }
  const results = collectToolResults(messages)
  const out: SessionMessage[] = []
  for (const message of messages) {
    if (message.type === 'system') {
      // A system message is not a tool call: plugins answer for it through transcriptCard, and the answer rides on its payload.
      const payload = message.message as { subtype?: unknown; pluginCard?: unknown }
      if (!systems || typeof payload?.subtype !== 'string') { out.push(message); continue }
      const key = `sys:${provider}@${providerInstanceId ?? ''}:${sessionId}:${message.uuid}`
      let card: PluginToolCard | null | undefined = cache.get(key)
      if (card === undefined) {
        const answered = await host.transcriptCard({ target, block: { kind: 'system', id: message.uuid, subtype: payload.subtype, payload: boundSystemPayload(message.message as Record<string, unknown>) } })
        card = answered ? { pluginId: answered.pluginId, title: answered.title ?? payload.subtype, lines: answered.lines, tone: answered.tone, ...(answered.blocks ? { blocks: answered.blocks } : {}) } : null
        cache.set(key, card)
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
      }
      out.push(card ? { ...message, message: { ...(message.message as SystemMessagePayload), pluginCard: card } } : message)
      continue
    }
    if (!tools) { out.push(message); continue }
    const content = (message.message as { content?: unknown })?.content
    if (!Array.isArray(content) || !content.some((block: ContentBlock) => block?.type === 'tool_use')) { out.push(message); continue }
    let changed = false
    const next = await Promise.all((content as ContentBlock[]).map(async (block) => {
      if (block?.type !== 'tool_use') return block
      const tool = block as ToolUseBlock
      // A call is presented twice: running, then finished. The result is part of the question, so it is part of the key.
      const result = results.get(tool.id)
      const key = `${provider}@${providerInstanceId ?? ''}:${sessionId}:${tool.id}:${result ? `${result.isError ? 'e' : 'r'}${result.text.length}${result.truncated ? 't' : ''}` : 'pending'}`
      let card: PluginToolCard | null | undefined = cache.get(key)
      if (card === undefined) {
        const answered = await host.toolCard({ target, tool: { id: tool.id, name: tool.name, input: tool.input ?? {} }, ...(result ? { result } : {}) })
        const fresh: PluginToolCard | null = answered ? { pluginId: answered.pluginId, title: answered.title ?? tool.name, lines: answered.lines, tone: answered.tone, ...(answered.blocks ? { blocks: answered.blocks } : {}) } : null
        card = fresh
        cache.set(key, fresh)
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
      }
      if (!card) { noteUnrendered(target, tool, result); return block }
      changed = true
      return { ...tool, pluginCard: card }
    }))
    out.push(changed ? { ...message, message: { ...(message.message as object), content: next } } as SessionMessage : message)
  }
  return out
}

/** Forget cached answers (a plugin turned off or on changes what a call reads as). */
export function clearPluginToolCardCache(): void { cache.clear() }
