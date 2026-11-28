// The composer strip's optional readings, from what the app already holds: the
// transcript, the account's plan windows and the linked pull request. Shared by
// the TUI and the web. A reading with no data is left out, never shown as zero.
import type { ComposerStripPart } from './composerStrip'
import { summarizePrStatus, type PrActionable } from './github/prWork'

export type SessionStripStats = {
  /** The newest reply's input (cache reads and writes included) and output tokens. */
  lastTokens: { input: number; output: number } | null
  /** Cache reads over all input tokens, 0-1; null when nothing reported caching. */
  cacheHitRatio: number | null
  /** Estimated from Edit, MultiEdit and Write calls that did not fail. */
  lines: { added: number; removed: number } | null
  /** Time spent in turns, from each prompt to its last row. Idle time between turns is not counted. */
  activeMs: number | null
}

type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }
type Block = { type?: string; name?: string; id?: string; input?: Record<string, unknown>; tool_use_id?: string; is_error?: boolean }
type Row = { type?: string; message?: unknown; timestamp?: string; parent_tool_use_id?: string | null }

const lineCount = (value: unknown) => typeof value === 'string' && value ? value.replace(/\n$/, '').split('\n').length : 0

export function computeSessionStripStats(messages: ReadonlyArray<Row>): SessionStripStats {
  // One API reply may arrive as several rows repeating its usage; the last one per id counts.
  const usageById = new Map<unknown, Usage>()
  let lastTokens: SessionStripStats['lastTokens'] = null
  const edits = new Map<unknown, { added: number; removed: number }>()
  const failed = new Set<unknown>()
  let activeMs = 0
  let turnStart: number | null = null
  let turnEnd = 0
  const endTurn = () => { if (turnStart !== null) activeMs += Math.max(0, turnEnd - turnStart) }
  for (const row of messages) {
    const api = row.message as { id?: unknown; usage?: Usage; content?: unknown } | undefined
    const blocks = Array.isArray(api?.content) ? api.content as Block[] : []
    const subagent = Boolean(row.parent_tool_use_id)
    const at = row.timestamp ? Date.parse(row.timestamp) : NaN
    const prompt = row.type === 'user' && !subagent
      && (typeof api?.content === 'string' || (blocks.some(block => block.type === 'text') && !blocks.some(block => block.type === 'tool_result')))
    if (!Number.isNaN(at)) {
      if (prompt) { endTurn(); turnStart = at; turnEnd = at }
      else if (turnStart !== null) turnEnd = Math.max(turnEnd, at)
    }
    if (row.type === 'assistant' && api?.usage) {
      usageById.set(api.id ?? row, api.usage)
      if (!subagent) {
        const input = (api.usage.input_tokens ?? 0) + (api.usage.cache_read_input_tokens ?? 0) + (api.usage.cache_creation_input_tokens ?? 0)
        const output = api.usage.output_tokens ?? 0
        if (input || output) lastTokens = { input, output }
      }
    }
    for (const block of blocks) {
      if (block.type === 'tool_result' && block.is_error) failed.add(block.tool_use_id)
      if (block.type !== 'tool_use' || !block.input) continue
      const input = block.input
      if (block.name === 'Edit') edits.set(block.id ?? block, { added: lineCount(input.new_string), removed: lineCount(input.old_string) })
      else if (block.name === 'Write') edits.set(block.id ?? block, { added: lineCount(input.content), removed: 0 })
      else if (block.name === 'MultiEdit' && Array.isArray(input.edits)) {
        const parts = input.edits as Array<Record<string, unknown>>
        edits.set(block.id ?? block, {
          added: parts.reduce((sum, part) => sum + lineCount(part.new_string), 0),
          removed: parts.reduce((sum, part) => sum + lineCount(part.old_string), 0),
        })
      }
    }
  }
  endTurn()
  let read = 0, cached = 0, all = 0
  for (const usage of usageById.values()) {
    const hits = usage.cache_read_input_tokens ?? 0
    const writes = usage.cache_creation_input_tokens ?? 0
    read += hits
    cached += hits + writes
    all += (usage.input_tokens ?? 0) + hits + writes
  }
  let added = 0, removed = 0
  for (const [id, edit] of edits) if (!failed.has(id)) { added += edit.added; removed += edit.removed }
  return {
    lastTokens,
    cacheHitRatio: cached > 0 && all > 0 ? read / all : null,
    lines: added || removed ? { added, removed } : null,
    activeMs: activeMs > 0 ? activeMs : null,
  }
}

export type StripTone = 'dim' | 'good' | 'warn' | 'bad'
export type StripStatEntry = { text: string; tone: StripTone; part: ComposerStripPart; urgent?: boolean; tightest?: boolean }

const shortTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

export function stripDurationText(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** When a plan window resets, as the clock reads it: `6:50pm` today, `Sat 3pm` otherwise. */
export function formatLimitReset(resetsAt: number, now = Date.now()): string {
  const at = new Date(resetsAt)
  const hours = at.getHours()
  const minutes = at.getMinutes()
  const clock = `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}${hours < 12 ? 'am' : 'pm'}`
  if (resetsAt - now < 20 * 60 * 60 * 1000 && at.getDate() === new Date(now).getDate()) return clock
  return `${at.toLocaleDateString('en', { weekday: 'short' })} ${clock}`
}

/** One entry per plan window that has not reset; from 75% a window is urgent and always shown. */
export function stripLimitEntries(windows: ReadonlyArray<{ label: string; utilization: number; resetsAt: number | null }>, now = Date.now()): StripStatEntry[] {
  const live = windows.filter(window => window.resetsAt === null || window.resetsAt > now)
  const top = Math.max(...live.map(window => window.utilization))
  let marked = false
  return live.map(window => {
    const pct = Math.round(window.utilization)
    const tightest = !marked && window.utilization === top
    marked ||= tightest
    return {
      text: `limit:${window.label} ${pct}%${window.resetsAt === null ? '' : ` ↻${formatLimitReset(window.resetsAt, now)}`}`,
      tone: pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : 'dim', part: 'limit', urgent: pct >= 75, tightest,
    }
  })
}

/** The pull request in two words: its number and the thing that matters most about it. */
export function stripPrEntry(pr: PrActionable & { number: number }): StripStatEntry {
  const { tone, parts } = summarizePrStatus(pr)
  const word = parts.find(part => !part.startsWith('Stack ') && part !== 'Checks passed') ?? parts[parts.length - 1]!
  return {
    text: `PR #${pr.number} ${word.startsWith('Conflicts') ? 'Conflicts' : word}`,
    tone: tone === 'danger' ? 'bad' : tone === 'warning' ? 'warn' : tone === 'success' ? 'good' : 'dim', part: 'pr',
  }
}

export function stripStatEntries(stats: SessionStripStats | null): StripStatEntry[] {
  if (!stats) return []
  const entries: StripStatEntry[] = []
  if (stats.lastTokens) entries.push({ text: `tokens:↑${shortTokens(stats.lastTokens.input)} ↓${shortTokens(stats.lastTokens.output)}`, tone: 'dim', part: 'tokens' })
  if (stats.cacheHitRatio !== null) entries.push({ text: `cache:${Math.round(stats.cacheHitRatio * 100)}% hit`, tone: 'dim', part: 'cache' })
  if (stats.lines) entries.push({ text: `lines:~+${stats.lines.added} -${stats.lines.removed}`, tone: 'dim', part: 'lines' })
  if (stats.activeMs !== null) entries.push({ text: `active:${stripDurationText(stats.activeMs)}`, tone: 'dim', part: 'duration' })
  return entries
}
