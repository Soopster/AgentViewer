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

export type ThreadedBlock = TextBlock | ThinkingBlock | ImageBlock | ToolThread | TaskNotificationBlock | SystemReminderBlock | SlashCommandBlock | LocalCommandStdoutBlock

export type ThreadedMessage = {
  role: 'user' | 'assistant'
  uuid: string
  sessionId?: string
  timestamp?: string
  origin?: { kind: string }
  usage?: ApiMessage['usage']
  provider?: AgentProvider
  blocks: ThreadedBlock[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function xmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? m[1].trim() : ''
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

/** Finds all special XML regions in text and returns them sorted by position. */
function findSpecialRegions(text: string): SpecialRegion[] {
  const regions: SpecialRegion[] = []

  // system-reminder
  for (const m of text.matchAll(/<system-reminder>([\s\S]*?)<\/system-reminder>/g)) {
    regions.push({ kind: 'system_reminder', start: m.index!, end: m.index! + m[0].length, content: m[1].trim() })
  }

  // local-command-stdout
  for (const m of text.matchAll(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/g)) {
    regions.push({ kind: 'local_command_stdout', start: m.index!, end: m.index! + m[0].length, stdout: m[1].trim() })
  }

  // slash-command cluster: starts at <command-name>, ends at </command-args> (or </command-message> or </command-name>)
  for (const m of text.matchAll(/<command-name>([\s\S]*?)<\/command-name>/g)) {
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
function splitSystemReminders(text: string): Array<TextBlock | SystemReminderBlock | SlashCommandBlock | LocalCommandStdoutBlock> {
  const regions = findSpecialRegions(text)
  if (regions.length === 0) return [{ type: 'text', text }]

  const out: Array<TextBlock | SystemReminderBlock | SlashCommandBlock | LocalCommandStdoutBlock> = []
  let cursor = 0

  for (const region of regions) {
    if (region.start < cursor) continue // overlapping — skip (e.g. sibling command tags already consumed)
    const before = text.slice(cursor, region.start).trim()
    if (before) out.push({ type: 'text', text: before })

    if (region.kind === 'system_reminder')     out.push({ type: 'system_reminder',      content: region.content })
    if (region.kind === 'local_command_stdout') out.push({ type: 'local_command_stdout', stdout:  region.stdout  })
    if (region.kind === 'slash_command')        out.push(region.block)

    cursor = region.end
  }

  const after = text.slice(cursor).trim()
  if (after) out.push({ type: 'text', text: after })

  return out
}

function toBlocks(msg: SessionMessage): ContentBlock[] {
  const c = msg.message.content
  if (typeof c === 'string') return c ? [{ type: 'text', text: c }] : []
  return (c ?? []) as ContentBlock[]
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
  for (const msg of messages) seen.set(msg.uuid, msg)
  const deduped = [...seen.values()]

  // Pass 1: collect all tool results and mark plumbing turns
  const resultMap = new Map<string, ToolResultBlock>()
  const plumbingUuids = new Set<string>()

  for (const msg of deduped) {
    if (!isPlumbingTurn(msg)) continue
    plumbingUuids.add(msg.uuid)
    for (const b of toBlocks(msg)) {
      const r = b as ToolResultBlock
      resultMap.set(r.tool_use_id, r)
    }
  }

  // Pass 2: build threaded messages, skipping plumbing turns
  const out: ThreadedMessage[] = []

  for (const msg of deduped) {
    if (plumbingUuids.has(msg.uuid)) continue

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
        usage: msg.message.usage,
        provider: msg.provider,
        blocks: threadedBlocks,
      })
    }
  }

  return out
}
