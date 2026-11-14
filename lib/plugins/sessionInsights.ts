// Session insights as a plugin service: what the index recorded about a
// session's edits, and searching the index with facets. Browser-safe types and
// pure derivations shared by both renderers' views.
import type { SessionProvenanceResult } from '../provenance'
import type { PersistedFileEditRecord, PersistedSearchParams, PersistedSearchResponse } from '../session-index/types'
import type { AgentProvider, SessionMessage } from '../types'

export type PluginSessionInsightsService = {
  /** The provenance summary and the recorded edits (with their prompts) for one session. */
  readonly provenance: (session: { provider: AgentProvider; sessionId: string }, signal?: AbortSignal) => Promise<{ summary: SessionProvenanceResult; edits: PersistedFileEditRecord[] }>
  readonly search: (params: PersistedSearchParams, signal?: AbortSignal) => Promise<PersistedSearchResponse>
}

export type TimedCall = { label: string; durationMs: number }
export type TimedTurn = { key: string; title: string; calls: TimedCall[]; totalMs: number; maxMs: number }

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
type Block = { type?: string; id?: string; name?: string; text?: string; tool_use_id?: string; input?: Record<string, unknown> }
const blocksOf = (message: SessionMessage): Block[] => {
  const content = (message.message as { content?: unknown } | undefined)?.content
  return Array.isArray(content) ? content as Block[] : typeof content === 'string' ? [{ type: 'text', text: content }] : []
}
const tsOf = (message: SessionMessage) => { const value = message.timestamp ? Date.parse(message.timestamp) : NaN; return Number.isFinite(value) ? value : null }

/** A tool call's label: its name and the argument that says what it acted on. */
function callLabel(block: Block): string {
  const input = block.input ?? {}
  const subject = ['command', 'file_path', 'path', 'pattern', 'url', 'description'].map(key => input[key]).find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  return subject ? `${block.name ?? 'tool'} ${oneLine(subject).slice(0, 80)}` : (block.name ?? 'tool')
}

/**
 * Tool timing from a raw transcript: a call lasts from the message that made it
 * to the message carrying its result. Newest turn first; a turn with no timed
 * call is dropped, as the TUI's card-based derivation does.
 */
export function timedTurnsFromMessages(messages: readonly SessionMessage[]): TimedTurn[] {
  const turns: Array<{ key: string; title: string; calls: TimedCall[] }> = [{ key: 'earlier', title: 'earlier', calls: [] }]
  const open = new Map<string, { label: string; at: number; turn: (typeof turns)[number] }>()
  for (const message of messages) {
    const blocks = blocksOf(message)
    const at = tsOf(message)
    if (message.type === 'user') {
      for (const block of blocks) {
        if (block.type !== 'tool_result' || !block.tool_use_id) continue
        const started = open.get(block.tool_use_id)
        if (started && at !== null) started.turn.calls.push({ label: started.label, durationMs: Math.max(0, at - started.at) })
        open.delete(block.tool_use_id)
      }
      const text = blocks.filter(block => block.type === 'text' && block.text?.trim()).map(block => block.text!).join(' ')
      if (text && !blocks.some(block => block.type === 'tool_result')) turns.push({ key: message.uuid, title: oneLine(text).slice(0, 120) || 'prompt', calls: [] })
      continue
    }
    if (message.type !== 'assistant' || at === null) continue
    for (const block of blocks) if (block.type === 'tool_use' && block.id) open.set(block.id, { label: callLabel(block), at, turn: turns[turns.length - 1]! })
  }
  return turns
    .filter(turn => turn.calls.length > 0)
    .map(turn => ({ ...turn, totalMs: turn.calls.reduce((sum, call) => sum + call.durationMs, 0), maxMs: Math.max(...turn.calls.map(call => call.durationMs)) }))
    .reverse()
}
