import type {
  AgentProvider,
  SessionMessage,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  TextBlock,
  ThinkingBlock,
  ImageBlock,
  ApiMessage,
  SystemMessagePayload,
} from './types'

// ── Output types ──────────────────────────────────────────────────────────────

export type ToolThread = {
  type: 'tool_thread'
  toolUse: ToolUseBlock
  /** null when no matching result was found (e.g. session ended mid-turn) */
  result: ToolResultBlock | null
}

export type TaskNotificationBlock = {
  type: 'task_notification'
  taskId: string
  toolUseId: string
  outputFile: string
  status: string
  summary: string
  result: string
  usage: { totalTokens?: number; toolUses?: number; durationMs?: number }
}

export type SystemReminderBlock = {
  type: 'system_reminder'
  content: string
}

export type ClaudeSystemBlock = {
  type: 'claude_system'
  subtype: string
  payload: SystemMessagePayload
}

export type SlashCommandBlock = {
  type: 'slash_command'
  command: string
  message: string
  args: string
}

export type LocalCommandStdoutBlock = {
  type: 'local_command_stdout'
  stdout: string
}

/** A `!command` the user ran from the input box (Claude Code bash mode). */
export type BashInputBlock = {
  type: 'bash_input'
  command: string
}

/** Output of an input-box `!command` — persisted as <bash-stdout>/<bash-stderr>. */
export type BashOutputBlock = {
  type: 'bash_output'
  stdout: string
  stderr: string
}

export type ThreadedBlock = TextBlock | ThinkingBlock | ImageBlock | ToolThread | TaskNotificationBlock | SystemReminderBlock | SlashCommandBlock | LocalCommandStdoutBlock | BashInputBlock | BashOutputBlock | ClaudeSystemBlock

export type ThreadedMessage = {
  role: 'user' | 'assistant' | 'system'
  uuid: string
  sessionId?: string
  timestamp?: string
  origin?: { kind: string }
  usage?: ApiMessage['usage']
  provider?: AgentProvider
  taskDescription?: string
  requestId?: string
  blocks: ThreadedBlock[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// LRU-capped: tags are drawn from a small known set (task-notification,
// command-name, …) so this cap is comfortably above steady state and just
// prevents a leak if an unusual or attacker-controlled tag ever appears.
const XML_TAG_RE_CACHE_MAX = 32
const XML_TAG_RE_CACHE = new Map<string, RegExp>()
function xmlTagRegex(tag: string): RegExp {
  const cached = XML_TAG_RE_CACHE.get(tag)
  if (cached) {
    XML_TAG_RE_CACHE.delete(tag)
    XML_TAG_RE_CACHE.set(tag, cached)
    return cached
  }
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)
  XML_TAG_RE_CACHE.set(tag, re)
  while (XML_TAG_RE_CACHE.size > XML_TAG_RE_CACHE_MAX) {
    const oldest = XML_TAG_RE_CACHE.keys().next().value
    if (oldest === undefined) break
    XML_TAG_RE_CACHE.delete(oldest)
  }
  return re
}

function xmlTag(xml: string, tag: string): string {
  const m = xml.match(xmlTagRegex(tag))
  return m ? m[1].trim() : ''
}

const SYSTEM_REMINDER_RE = /<system-reminder>([\s\S]*?)<\/system-reminder>/g
const LOCAL_COMMAND_STDOUT_RE = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g
const COMMAND_NAME_RE = /<command-name>([\s\S]*?)<\/command-name>/g
const BASH_INPUT_RE = /<bash-input>([\s\S]*?)<\/bash-input>/g
const BASH_STDOUT_RE = /<bash-stdout>([\s\S]*?)<\/bash-stdout>/g

// The CLI XML-escapes command/output text before wrapping it in bash-* tags
// (observed in native transcripts: `bun &lt;command&gt;`). Reverse it for display.
function unescapeBashTagContent(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function parseTaskNotification(content: string): TaskNotificationBlock | null {
  if (!content.trimStart().startsWith('<task-notification>')) return null
  const taskId = xmlTag(content, 'task-id')
  if (!taskId) return null
  return {
    type: 'task_notification',
    taskId,
    toolUseId:  xmlTag(content, 'tool-use-id'),
    outputFile: xmlTag(content, 'output-file'),
    status:     xmlTag(content, 'status') || 'completed',
    summary:    xmlTag(content, 'summary'),
    result:     xmlTag(content, 'result'),
    usage: {
      totalTokens: parseInt(xmlTag(content, 'total_tokens'))  || undefined,
      toolUses:    parseInt(xmlTag(content, 'tool_uses'))     || undefined,
      durationMs:  parseInt(xmlTag(content, 'duration_ms'))   || undefined,
    },
  }
}

/** Parses a slash-command cluster into a SlashCommandBlock, or null if not present. */
function parseSlashCommand(text: string): SlashCommandBlock | null {
  if (!/<command-name>/.test(text)) return null
  return {
    type: 'slash_command',
    command: xmlTag(text, 'command-name'),
    message: xmlTag(text, 'command-message'),
    args:    xmlTag(text, 'command-args'),
  }
}

type SpecialRegion =
  | { kind: 'system_reminder'; start: number; end: number; content: string }
  | { kind: 'local_command_stdout'; start: number; end: number; stdout: string }
  | { kind: 'slash_command'; start: number; end: number; block: SlashCommandBlock }
  | { kind: 'bash_input'; start: number; end: number; command: string }
  | { kind: 'bash_output'; start: number; end: number; stdout: string; stderr: string }

/** Finds all special XML regions in text and returns them sorted by position. */
function findSpecialRegions(text: string): SpecialRegion[] {
  const regions: SpecialRegion[] = []

  // system-reminder
  for (const m of text.matchAll(SYSTEM_REMINDER_RE)) {
    regions.push({ kind: 'system_reminder', start: m.index!, end: m.index! + m[0].length, content: m[1].trim() })
  }

  // local-command-stdout
  for (const m of text.matchAll(LOCAL_COMMAND_STDOUT_RE)) {
    regions.push({ kind: 'local_command_stdout', start: m.index!, end: m.index! + m[0].length, stdout: m[1].trim() })
  }

  // bash-input (input-box `!command`)
  for (const m of text.matchAll(BASH_INPUT_RE)) {
    regions.push({ kind: 'bash_input', start: m.index!, end: m.index! + m[0].length, command: unescapeBashTagContent(m[1].trim()) })
  }

  // bash-stdout, optionally followed by a sibling bash-stderr — one output region
  for (const m of text.matchAll(BASH_STDOUT_RE)) {
    const start = m.index!
    let end = start + m[0].length
    let stderr = ''
    const rest = text.slice(end)
    const stderrMatch = /^\s*<bash-stderr>([\s\S]*?)<\/bash-stderr>/.exec(rest)
    if (stderrMatch) {
      end += stderrMatch[0].length
      stderr = unescapeBashTagContent(stderrMatch[1].trim())
    }
    regions.push({ kind: 'bash_output', start, end, stdout: unescapeBashTagContent(m[1].trim()), stderr })
  }

  // stderr-only output (no stdout tag preceding it)
  for (const m of text.matchAll(/<bash-stderr>([\s\S]*?)<\/bash-stderr>/g)) {
    const covered = regions.some((r) => r.kind === 'bash_output' && m.index! >= r.start && m.index! < r.end)
    if (!covered) {
      regions.push({ kind: 'bash_output', start: m.index!, end: m.index! + m[0].length, stdout: '', stderr: unescapeBashTagContent(m[1].trim()) })
    }
  }

  // slash-command cluster: starts at <command-name>, ends at </command-args> (or </command-message> or </command-name>)
  for (const m of text.matchAll(COMMAND_NAME_RE)) {
    const start = m.index!
    // Try to extend to the end of the cluster (command-args or command-message)
    const argsEnd  = text.indexOf('</command-args>',    start)
    const msgEnd   = text.indexOf('</command-message>', start)
    let end = m.index! + m[0].length
    if (argsEnd  !== -1) end = argsEnd  + '</command-args>'.length
    else if (msgEnd !== -1) end = msgEnd + '</command-message>'.length
    const cluster = text.slice(start, end)
    const block = parseSlashCommand(cluster)
    if (block) regions.push({ kind: 'slash_command', start, end, block })
  }

  regions.sort((a, b) => a.start - b.start)
  return regions
}

/**
 * Splits a text string into typed blocks: TextBlock, SystemReminderBlock,
 * SlashCommandBlock, and LocalCommandStdoutBlock.
 */
function splitSystemReminders(text: string): Array<TextBlock | SystemReminderBlock | SlashCommandBlock | LocalCommandStdoutBlock | BashInputBlock | BashOutputBlock> {
  const regions = findSpecialRegions(text)
  if (regions.length === 0) return [{ type: 'text', text }]

  const out: Array<TextBlock | SystemReminderBlock | SlashCommandBlock | LocalCommandStdoutBlock | BashInputBlock | BashOutputBlock> = []
  let cursor = 0

  for (const region of regions) {
    if (region.start < cursor) continue // overlapping — skip (e.g. sibling command tags already consumed)
    const before = text.slice(cursor, region.start).trim()
    if (before) out.push({ type: 'text', text: before })

    if (region.kind === 'system_reminder')     out.push({ type: 'system_reminder',      content: region.content })
    if (region.kind === 'local_command_stdout') out.push({ type: 'local_command_stdout', stdout:  region.stdout  })
    if (region.kind === 'slash_command')        out.push(region.block)
    if (region.kind === 'bash_input')           out.push({ type: 'bash_input',  command: region.command })
    if (region.kind === 'bash_output')          out.push({ type: 'bash_output', stdout: region.stdout, stderr: region.stderr })

    cursor = region.end
  }

  const after = text.slice(cursor).trim()
  if (after) out.push({ type: 'text', text: after })

  return out
}

function toBlocks(msg: SessionMessage): ContentBlock[] {
  if (msg.type === 'system') return []
  const c = msg.message.content
  if (typeof c === 'string') return c ? [{ type: 'text', text: c }] : []
  return (c ?? []) as ContentBlock[]
}

function toSystemPayload(msg: SessionMessage): SystemMessagePayload | null {
  if (msg.type !== 'system') return null
  return msg.message as SystemMessagePayload
}

// Subtypes that are SDK plumbing the user never sees from a real `claude` CLI
// process. Each send to a resumed session re-runs `query()`, which re-fires
// these — they pile up in the transcript and break the "continuing a session"
// illusion. The events are still persisted to the session file; we just hide
// them from the rendered timeline.
// `thinking_tokens` is a high-frequency live estimate (token count + delta) the
// SDK streams during a turn; it's surfaced on the live THINKING preview card, not
// as a persisted transcript row, so hide it from the rendered timeline.
const HIDDEN_PLUMBING_SUBTYPES = new Set(['init', 'status', 'thinking_tokens'])

function isHiddenPlumbingMessage(payload: SystemMessagePayload): boolean {
  if (HIDDEN_PLUMBING_SUBTYPES.has(payload.subtype)) return true
  // SessionStart hooks fire on every resume but the CLI only fires them once
  // per process. Suppress them so re-sends don't litter the transcript.
  if (
    (payload.subtype === 'hook_started'
      || payload.subtype === 'hook_progress'
      || payload.subtype === 'hook_response')
    && typeof payload.hook_event === 'string'
    && payload.hook_event === 'SessionStart'
  ) {
    return true
  }
  // Bare fallback event with no payload — the SDK occasionally emits
  // `{type:"system"}` with no subtype, which our normalizer fills in as
  // subtype "system". There's nothing to render.
  if (payload.subtype === 'system') {
    const keys = Object.keys(payload).filter(
      (k) => k !== 'type' && k !== 'subtype' && payload[k] !== undefined && payload[k] !== null,
    )
    if (keys.length === 0) return true
  }
  return false
}

function messageUsage(msg: SessionMessage): ApiMessage['usage'] | undefined {
  if (msg.type === 'system') return undefined
  return (msg.message as ApiMessage).usage
}

function isPlumbingTurn(msg: SessionMessage): boolean {
  if (msg.type !== 'user') return false
  const blocks = toBlocks(msg)
  return blocks.length > 0 && blocks.every(b => b.type === 'tool_result')
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Transforms a flat list of SessionMessages into threaded messages where each
 * tool_use block is paired with its tool_result inline, and pure "plumbing"
 * user turns (all tool_result content) are absorbed and hidden.
 */
export function buildThreadedMessages(messages: SessionMessage[]): ThreadedMessage[] {
  // Deduplicate by UUID — the JSONL can contain the same UUID multiple times
  // (retries, updates). Keep the last occurrence since it's the most recent.
  const seen = new Map<string, SessionMessage>()
  for (const msg of messages) seen.set(`${msg.provider ?? 'claude'}:${msg.uuid}`, msg)
  const deduped = [...seen.values()]

  // Pass 1: collect all tool results, mark plumbing turns, and gather any
  // messages retracted by a model_refusal_fallback. When a model refuses and the
  // SDK falls back to another model, it emits the refused partial's wire uuids in
  // `retracted_message_uuids` so consumers evict that stale content. Eviction is
  // idempotent — unknown/already-removed uuids are a no-op.
  const resultMap = new Map<string, ToolResultBlock>()
  const plumbingUuids = new Set<string>()
  const retractedUuids = new Set<string>()

  for (const msg of deduped) {
    const payload = toSystemPayload(msg)
    if (payload?.subtype === 'model_refusal_fallback' && Array.isArray(payload.retracted_message_uuids)) {
      for (const uuid of payload.retracted_message_uuids) {
        if (typeof uuid === 'string') retractedUuids.add(uuid)
      }
    }
    if (!isPlumbingTurn(msg)) continue
    plumbingUuids.add(msg.uuid)
    for (const b of toBlocks(msg)) {
      const r = b as ToolResultBlock
      resultMap.set(r.tool_use_id, r)
    }
  }

  // Pass 2: build threaded messages, skipping plumbing and retracted turns
  const out: ThreadedMessage[] = []

  for (const msg of deduped) {
    if (plumbingUuids.has(msg.uuid)) continue
    if (retractedUuids.has(msg.uuid)) continue

    const systemPayload = toSystemPayload(msg)
    if (systemPayload) {
      if (isHiddenPlumbingMessage(systemPayload)) continue
      out.push({
        role: 'system',
        uuid: msg.uuid,
        sessionId: msg.session_id,
        timestamp: msg.timestamp,
        origin: msg.origin,
        provider: msg.provider,
        blocks: [{
          type: 'claude_system',
          subtype: systemPayload.subtype,
          payload: systemPayload,
        }],
      })
      continue
    }

    // Task notification: string content from the agent orchestrator
    if (msg.type === 'user' && typeof msg.message.content === 'string') {
      const notif = parseTaskNotification(msg.message.content)
      if (notif) {
        out.push({ role: 'user', uuid: msg.uuid, sessionId: msg.session_id, timestamp: msg.timestamp, origin: msg.origin, provider: msg.provider, blocks: [notif] })
        continue
      }
    }

    const threadedBlocks: ThreadedBlock[] = []

    for (const b of toBlocks(msg)) {
      switch (b.type) {
        case 'tool_use': {
          const tu = b as ToolUseBlock
          threadedBlocks.push({
            type: 'tool_thread',
            toolUse: tu,
            result: resultMap.get(tu.id) ?? null,
          })
          break
        }
        case 'text': {
          const txt = (b as TextBlock).text
          if (txt.trim()) {
            for (const chunk of splitSystemReminders(txt)) threadedBlocks.push(chunk)
          }
          break
        }
        case 'thinking':
          threadedBlocks.push(b as ThinkingBlock)
          break
        case 'image':
          threadedBlocks.push(b as ImageBlock)
          break
      }
    }

    if (threadedBlocks.length > 0) {
      out.push({
        role: msg.type as 'user' | 'assistant',
        uuid: msg.uuid,
        sessionId: msg.session_id,
        timestamp: msg.timestamp,
        origin: msg.origin,
        usage: messageUsage(msg),
        provider: msg.provider,
        taskDescription: msg.taskDescription,
        requestId: msg.requestId,
        blocks: threadedBlocks,
      })
    }
  }

  return out
}

// ── Incremental threading ─────────────────────────────────────────────────────

export type IncrementalThreadingCache = {
  messages: SessionMessage[]
  threaded: ThreadedMessage[]
}

/**
 * Incremental variant of buildThreadedMessages for the common append-only case.
 *
 * During live polling, the existing prefix of `messages` never changes — only
 * new messages are appended. When the prefix is provably stable (same object
 * references), this function reuses the already-computed threaded output for
 * that prefix and only re-threads the suffix starting from the last non-plumbing
 * message. That lookback is necessary because a freshly-arrived plumbing turn
 * (tool_result) can complete a tool_use in the most recent assistant message.
 *
 * Returns null when the incremental path is unsafe, signalling the caller to
 * fall back to a full buildThreadedMessages() call.
 */
export function buildThreadedMessagesIncremental(
  messages: SessionMessage[],
  cache: IncrementalThreadingCache,
): ThreadedMessage[] | null {
  const { messages: prevMessages, threaded: prevThreaded } = cache

  // Only useful when messages grew
  if (messages.length <= prevMessages.length || prevMessages.length === 0) return null

  // Verify that the existing prefix is identical (same object references)
  for (let i = 0; i < prevMessages.length; i++) {
    if (messages[i] !== prevMessages[i]) return null
  }

  // Find the last non-plumbing message in the previous set — this is our
  // reprocess boundary. Everything before it is stable.
  let reprocessFromIndex = -1
  for (let i = prevMessages.length - 1; i >= 0; i--) {
    if (!isPlumbingTurn(prevMessages[i])) {
      reprocessFromIndex = i
      break
    }
  }

  // Need at least one stable message before the boundary to benefit
  if (reprocessFromIndex <= 0) return null

  // Re-thread from the boundary message through the new tail
  const partialThreaded = buildThreadedMessages(messages.slice(reprocessFromIndex))

  // Drop the boundary message from the cached threaded output and splice in
  // the freshly-built partial result (which now includes any new tool results)
  const boundaryMsg = prevMessages[reprocessFromIndex]
  const stablePrefix = prevThreaded.filter(
    t => !(t.uuid === boundaryMsg.uuid && (t.provider ?? null) === (boundaryMsg.provider ?? null)),
  )

  return [...stablePrefix, ...partialThreaded]
}

/**
 * Strips tool_thread blocks from each message. Messages left with no visible
 * blocks are dropped so the transcript doesn't show empty turns.
 */
export function stripToolCallBlocks(messages: ThreadedMessage[]): ThreadedMessage[] {
  const out: ThreadedMessage[] = []
  for (const msg of messages) {
    const kept = msg.blocks.filter((b) => b.type !== 'tool_thread')
    if (kept.length === 0) continue
    out.push(kept.length === msg.blocks.length ? msg : { ...msg, blocks: kept })
  }
  return out
}
