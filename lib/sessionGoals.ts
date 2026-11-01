// Session Goals — the pure half.
//
// A goal turns one prompt into a finish line: after every settled turn an
// independent auditor decides whether the session should keep going, has
// finished, or is blocked. This module holds only the shared shape, the key
// scheme and the prompt/schema for that audit, so the web route, the TUI and
// the engine can all agree on it. Persistence lives in sessionGoalStore.ts.

import type { AgentProvider, SessionMessage } from './types'

export const SESSION_GOAL_STATUSES = ['active', 'paused', 'complete', 'blocked', 'budget'] as const
export type SessionGoalStatus = (typeof SESSION_GOAL_STATUSES)[number]

export type SessionGoalDecision = 'continue' | 'complete' | 'blocked'

export type SessionGoal = {
  provider: AgentProvider
  providerInstanceId?: string
  sessionId: string
  objective: string
  status: SessionGoalStatus
  /** Total token ceiling across continuations; null means no ceiling. */
  tokenBudget: number | null
  /** Tokens observed by the auditor so far (goal-scoped, not whole-session). */
  tokensUsed: number
  continuations: number
  /** Hard stop so a confused auditor cannot keep a session alive forever. */
  maxContinuations: number
  createdAt: string
  updatedAt: string
  lastNote: string | null
  lastDecision: SessionGoalDecision | null
  lastEvaluatedAt: string | null
  /** Set when the engine stopped on a transport/auditor failure. */
  error: string | null
}

/** Matches OpenChamber's safety stops: enough for real work, not a runaway. */
export const DEFAULT_MAX_CONTINUATIONS = 25
/** Default model budget offered in the UI when a ceiling is wanted. */
export const DEFAULT_GOAL_TOKEN_BUDGET = 2_000_000
export const MAX_OBJECTIVE_LENGTH = 8_000

export const SESSION_GOAL_STATUS_LABEL: Record<SessionGoalStatus, string> = {
  active: 'Goal active',
  paused: 'Goal paused',
  complete: 'Goal complete',
  blocked: 'Goal blocked',
  budget: 'Goal budget spent',
}

export const SESSION_GOAL_STATUS_TONE: Record<SessionGoalStatus, 'info' | 'success' | 'warning' | 'error'> = {
  active: 'info',
  paused: 'warning',
  complete: 'success',
  blocked: 'error',
  budget: 'warning',
}

/** Identity tuple matching `sessionIdentityKey`, but JSON-safe for storage. */
export function sessionGoalKey(provider: AgentProvider, providerInstanceId: string | undefined, sessionId: string): string {
  return JSON.stringify([provider, providerInstanceId || provider, sessionId])
}

export function sessionGoalKeyFor(goal: Pick<SessionGoal, 'provider' | 'providerInstanceId' | 'sessionId'>): string {
  return sessionGoalKey(goal.provider, goal.providerInstanceId, goal.sessionId)
}

export function parseSessionGoalKey(key: string): { provider: AgentProvider; providerInstanceId: string; sessionId: string } | null {
  try {
    const parts = JSON.parse(key) as unknown
    if (!Array.isArray(parts) || parts.length !== 3) return null
    const [provider, providerInstanceId, sessionId] = parts
    if (typeof provider !== 'string' || typeof providerInstanceId !== 'string' || typeof sessionId !== 'string') return null
    return { provider: provider as AgentProvider, providerInstanceId, sessionId }
  } catch {
    return null
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asStatus(value: unknown): SessionGoalStatus {
  return SESSION_GOAL_STATUSES.includes(value as SessionGoalStatus) ? value as SessionGoalStatus : 'paused'
}

export function sanitizeSessionGoal(value: unknown, fallbackProvider?: AgentProvider, fallbackSessionId?: string): SessionGoal | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const sessionId = asString(record.sessionId) ?? fallbackSessionId
  const provider = asString(record.provider) as AgentProvider | null ?? fallbackProvider ?? null
  const objective = asString(record.objective)
  if (!sessionId || !provider || !objective) return null
  const now = new Date().toISOString()
  const status = asStatus(record.status)
  const tokenBudget = typeof record.tokenBudget === 'number' && Number.isFinite(record.tokenBudget) && record.tokenBudget > 0
    ? Math.floor(record.tokenBudget)
    : null
  const maxContinuations = typeof record.maxContinuations === 'number' && Number.isFinite(record.maxContinuations) && record.maxContinuations > 0
    ? Math.floor(record.maxContinuations)
    : DEFAULT_MAX_CONTINUATIONS
  return {
    provider,
    ...(asString(record.providerInstanceId) ? { providerInstanceId: asString(record.providerInstanceId)! } : {}),
    sessionId,
    objective: objective.slice(0, MAX_OBJECTIVE_LENGTH),
    status,
    tokenBudget,
    tokensUsed: typeof record.tokensUsed === 'number' && Number.isFinite(record.tokensUsed) && record.tokensUsed >= 0
      ? Math.floor(record.tokensUsed)
      : 0,
    continuations: typeof record.continuations === 'number' && Number.isFinite(record.continuations) && record.continuations >= 0
      ? Math.floor(record.continuations)
      : 0,
    maxContinuations,
    createdAt: asString(record.createdAt) ?? now,
    updatedAt: asString(record.updatedAt) ?? now,
    lastNote: asString(record.lastNote),
    lastDecision: record.lastDecision === 'continue' || record.lastDecision === 'complete' || record.lastDecision === 'blocked'
      ? record.lastDecision
      : null,
    lastEvaluatedAt: asString(record.lastEvaluatedAt),
    error: asString(record.error),
  }
}

/** True while the engine should keep nudging the session. */
export function isSessionGoalLive(goal: SessionGoal | null | undefined): goal is SessionGoal {
  return !!goal && goal.status === 'active'
}

function messageUsageTokens(message: SessionMessage): number {
  const usage = (message.message as {
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number | null
      cache_creation_input_tokens?: number | null
    }
  } | undefined)?.usage
  if (!usage) return 0
  return (usage.input_tokens ?? 0)
    + (usage.output_tokens ?? 0)
    + (usage.cache_read_input_tokens ?? 0)
    + (usage.cache_creation_input_tokens ?? 0)
}

/**
 * Tokens spent since `since`. Providers without message timestamps fall back to
 * the last assistant reply only, which under-counts history but never turns a
 * missing timestamp into an immediate budget stop.
 */
export function sumSessionGoalTokens(messages: readonly SessionMessage[], since: string, fallbackSince?: string): number {
  const sinceMs = Date.parse(since)
  const fallbackMs = fallbackSince ? Date.parse(fallbackSince) : sinceMs
  const assistants = messages.filter((message) => message.type === 'assistant' && message.message?.usage)
  if (assistants.length === 0) return 0
  const stamped = assistants.filter((message) => typeof message.timestamp === 'string' && message.timestamp)
  if (stamped.length === 0) return messageUsageTokens(assistants[assistants.length - 1])
  const cutoff = Number.isFinite(sinceMs) ? sinceMs : fallbackMs
  return stamped.reduce((total, message) => {
    const at = Date.parse(message.timestamp!)
    return Number.isFinite(at) && at >= cutoff ? total + messageUsageTokens(message) : total
  }, 0)
}

export function textOfMessage(message: SessionMessage): string {
  const content = message.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => block && block.type === 'text' && typeof (block as { text?: unknown }).text === 'string'
      ? (block as { text: string }).text
      : '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function lastAssistantText(messages: readonly SessionMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type !== 'assistant') continue
    const text = textOfMessage(message)
    if (text) return text
  }
  return ''
}

export function lastUserText(messages: readonly SessionMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type !== 'user') continue
    const text = textOfMessage(message)
    if (text && !text.startsWith('[goal]')) return text
  }
  return ''
}

/** The synthetic user turn the engine sends to keep the session working. */
export function buildGoalContinuationPrompt(goal: SessionGoal, note: string): string {
  const lines = [
    '[goal] Continue toward the objective below. This is an automated continuation — do not ask for confirmation or stop to check in.',
    '',
    '<objective>',
    goal.objective,
    '</objective>',
    '',
    `Continuation ${goal.continuations + 1} of at most ${goal.maxContinuations}.`,
  ]
  if (note) lines.push('', `Auditor note on the last turn: ${note}`)
  lines.push(
    '',
    'Keep working on the next concrete step. Verify your work where you can. Only stop when the objective is fully met — then say so explicitly and stop.',
  )
  return lines.join('\n')
}

export const SESSION_GOAL_AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    decision: {
      type: 'string',
      enum: ['continue', 'complete', 'blocked'],
      description: 'continue when more work is needed, complete when the objective is met, blocked when progress requires the user.',
    },
    note: { type: 'string', description: 'One or two sentences on the state of the work and what the next turn should do.' },
    nextPrompt: { type: 'string', description: 'Optional: the exact next instruction for the agent. Empty to use the default continuation.' },
  },
  required: ['decision', 'note'],
  additionalProperties: false,
} as const

export type SessionGoalAudit = { decision: SessionGoalDecision; note: string; nextPrompt?: string }

export function parseSessionGoalAudit(value: unknown): SessionGoalAudit | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const decision = record.decision
  if (decision !== 'continue' && decision !== 'complete' && decision !== 'blocked') return null
  const note = typeof record.note === 'string' ? record.note.trim() : ''
  const nextPrompt = typeof record.nextPrompt === 'string' && record.nextPrompt.trim() ? record.nextPrompt.trim() : undefined
  return { decision, note, ...(nextPrompt ? { nextPrompt } : {}) }
}

export function buildGoalAuditPrompt(input: {
  goal: SessionGoal
  lastAssistant: string
  lastUser: string
  transcriptTail?: string
}): string {
  const { goal, lastAssistant, lastUser, transcriptTail } = input
  const budget = goal.tokenBudget
    ? `${goal.tokensUsed.toLocaleString()} of ${goal.tokenBudget.toLocaleString()} tokens used`
    : `${goal.tokensUsed.toLocaleString()} tokens used, no ceiling`
  return [
    'You are auditing one automated coding session against its goal. Decide only from the objective and the transcript excerpt below.',
    '',
    `OBJECTIVE:\n${goal.objective}`,
    '',
    `PROGRESS: continuation ${goal.continuations} of at most ${goal.maxContinuations}; ${budget}.`,
    goal.lastNote ? `PREVIOUS AUDITOR NOTE:\n${goal.lastNote}` : '',
    '',
    `LAST USER MESSAGE:\n${lastUser || '(none)'}`,
    '',
    `LAST ASSISTANT REPLY:\n${lastAssistant || '(no reply yet)'}`,
    transcriptTail ? `\nEARLIER TURNS (truncated):\n${transcriptTail}` : '',
    '',
    'Rules:',
    '- complete only when the objective is actually met and verified by the transcript.',
    '- blocked only when the agent cannot proceed without a human decision, credentials, or access.',
    '- continue when there is a concrete next step the agent can take on its own.',
    '- Never invent work outside the objective.',
    'Return the JSON object described by the schema.',
  ].filter(Boolean).join('\n')
}
