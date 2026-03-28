import type {
  SessionMessage,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  TextBlock,
  ThinkingBlock,
  ImageBlock,
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

export type ThreadedBlock = TextBlock | ThinkingBlock | ImageBlock | ToolThread | TaskNotificationBlock | SystemReminderBlock

export type ThreadedMessage = {
  role: 'user' | 'assistant'
  uuid: string
  timestamp?: string
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

/** Splits a text string into alternating TextBlocks and SystemReminderBlocks. */
function splitSystemReminders(text: string): Array<TextBlock | SystemReminderBlock> {
  const out: Array<TextBlock | SystemReminderBlock> = []
  const matches = [...text.matchAll(/<system-reminder>([\s\S]*?)<\/system-reminder>/g)]
  if (matches.length === 0) return [{ type: 'text', text }]

  let lastIndex = 0
  for (const match of matches) {
    const before = text.slice(lastIndex, match.index).trim()
    if (before) out.push({ type: 'text', text: before })
    const content = match[1].trim()
    if (content) out.push({ type: 'system_reminder', content })
    lastIndex = (match.index ?? 0) + match[0].length
  }

  const after = text.slice(lastIndex).trim()
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
        out.push({ role: 'user', uuid: msg.uuid, timestamp: msg.timestamp, blocks: [notif] })
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
        timestamp: msg.timestamp,
        blocks: threadedBlocks,
      })
    }
  }

  return out
}
