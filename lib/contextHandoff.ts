import type { SessionMessage } from './types'

/** Longest excerpt kept from any one message — a handoff carries the thread of the work, not every tool dump. */
const EXCERPT_CHARS = 700
/** Whole-handoff budget for the conversation tail; the brief above it is separate and already bounded. */
const TAIL_CHARS = 9000
const MAX_EXCHANGES = 8

const INJECTED_USER_ROW = /^<(bash-input|bash-stdout|bash-stderr|local-command|command-name|command-message|task-notification|system-reminder)/

function textOf(content: unknown, only: 'text'): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((block) => (block && typeof block === 'object' && (block as { type?: unknown }).type === only
      && typeof (block as { text?: unknown }).text === 'string' ? [(block as { text: string }).text] : []))
    .join('\n\n')
    .trim()
}

function excerpt(text: string): string {
  const flat = text.replace(/\n{3,}/g, '\n\n').trim()
  return flat.length <= EXCERPT_CHARS ? flat : `${flat.slice(0, EXCERPT_CHARS).trimEnd()}…`
}

/**
 * The recent back-and-forth as plain text, newest last. Only what the user
 * typed and what the assistant said: tool calls and results are the agent's
 * working, and the brief already summarizes what they changed.
 */
export function conversationTail(raw: readonly SessionMessage[]): string {
  const turns: string[] = []
  for (const message of raw) {
    if (message.parent_tool_use_id != null || message.type === 'system') continue
    const text = textOf((message.message as { content?: unknown }).content, 'text')
    if (!text) continue
    if (message.type === 'user') {
      if (INJECTED_USER_ROW.test(text)) continue
      turns.push(`User: ${excerpt(text)}`)
    } else {
      turns.push(`Assistant: ${excerpt(text)}`)
    }
  }
  const kept: string[] = []
  let used = 0
  for (const turn of turns.slice(-MAX_EXCHANGES * 2).reverse()) {
    if (used + turn.length > TAIL_CHARS && kept.length > 0) break
    kept.push(turn)
    used += turn.length
  }
  return kept.reverse().join('\n\n')
}

/**
 * The first message of a conversation continued on another provider: what the
 * work is (the brief), then what was just said. A handoff is an explicit
 * artifact the user can read and edit before sending — not a hidden prompt.
 */
export function buildContextHandoffPrompt(input: {
  fromProvider: string
  brief: string
  raw: readonly SessionMessage[]
}): string {
  const tail = conversationTail(input.raw)
  return [
    `You are continuing work that was started in a ${input.fromProvider} session. You have no memory of it; this is everything carried over.`,
    input.brief.trim(),
    tail ? `## Recent conversation\n\n${tail}` : '',
    'Pick up from here. Check the current state of the files before changing anything.',
  ].filter(Boolean).join('\n\n')
}
