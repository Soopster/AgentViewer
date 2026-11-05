// Session recaps — the pure half.
//
// After a session has been quiet for a while, one cheap model call reads the
// last few user turns and writes a one-line recap ("what now works
// differently") plus, when there is an obvious next step, a message the user
// could send to the agent as it stands. This module holds the shared shape, the
// key scheme, the prompt and the output normalization; persistence is in
// sessionRecapStore.ts and the trigger in sessionRecapEngine.ts.

import { textOfMessage } from './sessionGoals'
import type { AgentProvider, SessionMessage } from './types'

export type SessionRecap = {
  /** What the last turns changed, in a sentence. */
  text: string
  /** A sendable follow-up for the agent; absent when finished or a decision is the user's. */
  suggestion?: string
  /** ISO time the recap was written. */
  at: string
}

export const RECAP_USER_TURNS = 3
export const RECAP_WORD_LIMIT = 20
export const RECAP_TEXT_MAX_CHARS = 200
export const RECAP_SUGGESTION_MAX_CHARS = 2_000
const USER_TEXT_MAX = 8_000
const ASSISTANT_TEXT_MAX = 16_000
const PROMPT_TOTAL_MAX = 32_000

export const SESSION_RECAP_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    recap: { type: 'string' },
    suggestion: { type: 'string' },
  },
  required: ['recap'],
}

/** Same identity tuple the goal and inbox stores use, so one account's session never reads another's recap. */
export function sessionRecapKey(provider: AgentProvider, providerInstanceId: string | undefined, sessionId: string): string {
  return JSON.stringify([provider, providerInstanceId || provider, sessionId])
}

/**
 * A recap describes the transcript as it was when written, and the engine
 * writes it a minute after the last write. Anything newer in the transcript
 * (`lastModified` is the provider's own mtime) means the recap is describing a
 * past turn and must not be shown.
 */
export function isSessionRecapFresh(recap: SessionRecap | null | undefined, lastModified: number | undefined): recap is SessionRecap {
  if (!recap) return false
  const at = Date.parse(recap.at)
  if (!Number.isFinite(at)) return false
  return lastModified === undefined || lastModified <= at
}

export function sanitizeSessionRecap(value: unknown): SessionRecap | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text.trim() : ''
  const at = typeof record.at === 'string' && Number.isFinite(Date.parse(record.at)) ? record.at : null
  if (!text || !at) return null
  const suggestion = typeof record.suggestion === 'string' ? record.suggestion.trim() : ''
  return { text: text.slice(0, RECAP_TEXT_MAX_CHARS), ...(suggestion ? { suggestion: suggestion.slice(0, RECAP_SUGGESTION_MAX_CHARS) } : {}), at }
}

function isRecapPrompt(text: string): boolean {
  // A goal continuation is the viewer talking to the agent, not the user.
  return text.length > 0 && !text.startsWith('[goal]')
}

type Turn = { user: string; assistant: string }

/** The last `count` user turns, each with the assistant text that answered it. Tool traffic is dropped. */
export function recapTurns(messages: readonly SessionMessage[], count = RECAP_USER_TURNS): Turn[] {
  const turns: Turn[] = []
  for (const message of messages) {
    if (message.type !== 'user' && message.type !== 'assistant') continue
    const text = textOfMessage(message)
    if (!text) continue
    if (message.type === 'user') {
      if (!isRecapPrompt(text)) continue
      turns.push({ user: text.slice(-USER_TEXT_MAX), assistant: '' })
    } else if (turns.length > 0) {
      const turn = turns[turns.length - 1]
      turn.assistant = (turn.assistant ? `${turn.assistant}\n\n${text}` : text).slice(-ASSISTANT_TEXT_MAX)
    }
  }
  return turns.slice(-count)
}

function renderTurn(turn: Turn): string {
  return `User:\n${turn.user}\n\nAgent:\n${turn.assistant || '(no reply yet)'}`
}

/** Null when there is nothing to summarize. Oldest turns are dropped first to fit the budget. */
export function buildRecapPrompt(messages: readonly SessionMessage[]): string | null {
  let turns = recapTurns(messages)
  if (turns.length === 0) return null
  while (turns.length > 1 && turns.map(renderTurn).join('\n\n---\n\n').length > PROMPT_TOTAL_MAX) {
    turns = turns.slice(1)
  }
  const body = turns.map(renderTurn).join('\n\n---\n\n').slice(-PROMPT_TOTAL_MAX)
  return [
    'You write a one-line status for a coding-agent conversation that has just gone quiet.',
    'Below are the most recent exchanges between the user and the agent, oldest first.',
    '',
    `recap: at most ${RECAP_WORD_LIMIT} words, for the user. Say what now works differently or what was found, not what the agent did step by step. Plain text, no markdown, no quotes.`,
    'suggestion: a single message the user could send the agent next, written as the user would write it. Include it only when the next step is obvious and safe to take without further choices from the user.',
    'Use an empty string for suggestion when the work looks finished, when the agent asked the user a question, or when the next step depends on a decision only the user can make.',
    'Write in the language the user wrote in.',
    '',
    '<conversation>',
    body,
    '</conversation>',
  ].join('\n')
}

export function parseSessionRecapOutput(value: unknown, now = new Date()): SessionRecap | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const recap = typeof record.recap === 'string' ? record.recap.replace(/\s+/g, ' ').trim() : ''
  if (!recap) return null
  const suggestion = typeof record.suggestion === 'string' ? record.suggestion.trim() : ''
  return sanitizeSessionRecap({ text: recap, suggestion, at: now.toISOString() })
}
