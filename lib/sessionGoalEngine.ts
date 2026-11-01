// Session Goals — the engine.
//
// A settled turn is the only trigger. After a short delay (transcript writes
// land just after the running entry clears) one cheap model call audits the
// goal, and a `continue` decision starts the next turn through the same
// sessionBackend path the UI uses. Everything is process-local and guarded on
// globalThis, matching lib/sessionRuntime.ts, so a Next dev reload cannot
// double-schedule a continuation.

import {
  buildGoalAuditPrompt,
  buildGoalContinuationPrompt,
  isSessionGoalLive,
  lastAssistantText,
  lastUserText,
  parseSessionGoalAudit,
  SESSION_GOAL_AUDIT_SCHEMA,
  sessionGoalKey,
  sumSessionGoalTokens,
  textOfMessage,
  type SessionGoal,
  type SessionGoalAudit,
} from './sessionGoals'
import {
  listSessionGoalsForSessionId,
  patchSessionGoal,
  readSessionGoal,
  type SessionGoalTarget,
} from './sessionGoalStore'
import { getRunningSession, onTurnSettled, type TurnSettledEvent } from './sessionRuntime'
import { withProviderInstance } from './providerInstances'
import { listViewSessionMessages } from './sessionReads'
import { parseJsonObject, runStructuredQuery } from './oneShotLlm'
import type { SessionMessage } from './types'

/** Transcript persistence trails the running-entry clear by a beat. */
const SETTLE_DELAY_MS = 2_000
const AUDIT_TIMEOUT_MS = 120_000
const TRANSCRIPT_WINDOW = 400
const AUDIT_DEFAULT_MODEL = 'claude-haiku-4-5'
const AUDIT_NOTE_MAX = 500
const LAST_REPLY_MAX = 6_000

type GoalEngineState = {
  installed: boolean
  timers: Map<string, ReturnType<typeof setTimeout>>
  evaluating: Set<string>
}

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerSessionGoalEngineState: GoalEngineState | undefined
}

function engineState(): GoalEngineState {
  globalThis.__agentViewerSessionGoalEngineState ??= {
    installed: false,
    timers: new Map(),
    evaluating: new Set(),
  }
  return globalThis.__agentViewerSessionGoalEngineState
}

/**
 * Register the turn-settled observer. Idempotent; safe to call from any route
 * that touches a goal (creation arms it, reads re-arm it after a restart).
 */
export function ensureSessionGoalEngine(): void {
  const state = engineState()
  if (state.installed) return
  state.installed = true
  onTurnSettled((event) => scheduleGoalEvaluation(event))
}

function scheduleGoalEvaluation(event: TurnSettledEvent): void {
  const state = engineState()
  const key = sessionGoalKey(event.provider, event.providerInstanceId, event.sessionId)
  const existing = state.timers.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    state.timers.delete(key)
    void runGoalEvaluation(event)
  }, SETTLE_DELAY_MS)
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as { unref: () => void }).unref()
  }
  state.timers.set(key, timer)
}

/**
 * Evaluate right away instead of waiting for a settle event. Used when the
 * user resumes a goal whose last turn already finished.
 */
export function wakeSessionGoal(target: SessionGoalTarget): void {
  void runGoalEvaluation({
    sessionId: target.sessionId,
    provider: target.provider,
    ...(target.providerInstanceId ? { providerInstanceId: target.providerInstanceId } : {}),
  })
}

async function runGoalEvaluation(event: TurnSettledEvent): Promise<void> {
  const state = engineState()
  const key = sessionGoalKey(event.provider, event.providerInstanceId, event.sessionId)
  if (state.evaluating.has(key)) {
    // A turn settled while its own audit is still in flight (a continuation
    // that ended almost immediately, say). Queue behind it: dropping the event
    // would leave a live goal idle until the user typed something.
    scheduleGoalEvaluation(event)
    return
  }
  state.evaluating.add(key)
  try {
    if (event.providerInstanceId) {
      await withProviderInstance(event.providerInstanceId, event.provider, () => evaluateSessionGoal(event))
    } else {
      await evaluateSessionGoal(event)
    }
  } catch (error) {
    console.error('[session-goals] evaluation failed:', error)
  } finally {
    state.evaluating.delete(key)
  }
}

function auditModel(): string {
  const configured = process.env.AGENT_VIEWER_GOAL_MODEL?.trim()
  return configured || AUDIT_DEFAULT_MODEL
}

async function evaluateSessionGoal(event: TurnSettledEvent): Promise<void> {
  const target: SessionGoalTarget = {
    provider: event.provider,
    ...(event.providerInstanceId ? { providerInstanceId: event.providerInstanceId } : {}),
    sessionId: event.sessionId,
  }
  const goal = await readSessionGoal(target)
  if (!isSessionGoalLive(goal)) return
  // A manual turn started while the debounce was pending: let its own settle
  // event drive the next audit instead of racing it.
  if (getRunningSession(event.sessionId, { provider: event.provider, providerInstanceId: event.providerInstanceId })) return

  const messages = await listViewSessionMessages(event.sessionId, {
    limit: TRANSCRIPT_WINDOW,
    offset: 0,
    tail: true,
  }, event.provider)

  const since = goal.lastEvaluatedAt ?? goal.createdAt
  const tokensUsed = goal.tokensUsed + sumSessionGoalTokens(messages, since, goal.createdAt)
  const now = new Date().toISOString()

  if (goal.tokenBudget !== null && tokensUsed >= goal.tokenBudget) {
    await patchSessionGoal(target, {
      status: 'budget',
      tokensUsed,
      lastEvaluatedAt: now,
      lastNote: `Token budget of ${goal.tokenBudget.toLocaleString()} reached (${tokensUsed.toLocaleString()} used).`,
    })
    return
  }
  if (goal.continuations >= goal.maxContinuations) {
    await patchSessionGoal(target, {
      status: 'paused',
      tokensUsed,
      lastEvaluatedAt: now,
      lastNote: `Continuation limit reached (${goal.continuations} of ${goal.maxContinuations}). Resume to keep going.`,
    })
    return
  }

  let audit: SessionGoalAudit
  try {
    audit = await auditGoalProgress(goal, messages)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Auditor failed'
    await patchSessionGoal(target, {
      status: 'paused',
      tokensUsed,
      lastEvaluatedAt: now,
      error: message,
      lastNote: `Auditor could not judge progress: ${message}`,
    })
    return
  }

  if (audit.decision !== 'continue') {
    await patchSessionGoal(target, {
      status: audit.decision === 'complete' ? 'complete' : 'blocked',
      tokensUsed,
      lastEvaluatedAt: now,
      lastDecision: audit.decision,
      lastNote: audit.note || null,
      error: null,
    })
    return
  }

  const continuationGoal: SessionGoal = {
    ...goal,
    continuations: goal.continuations + 1,
    tokensUsed,
  }
  await patchSessionGoal(target, {
    continuations: continuationGoal.continuations,
    tokensUsed,
    lastEvaluatedAt: now,
    lastDecision: 'continue',
    lastNote: audit.note || null,
    error: null,
  })

  const prompt = audit.nextPrompt
    ? `[goal] ${audit.nextPrompt}\n\nObjective: ${goal.objective}\n\nThis is an automated continuation. Keep working until the objective is fully met, verify your work, then stop.`
    : buildGoalContinuationPrompt(goal, audit.note)

  try {
    await runContinuationTurn(target, prompt)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Continuation failed'
    await patchSessionGoal(target, {
      status: 'paused',
      error: message,
      lastNote: `Continuation failed: ${message}`,
    })
  }
}

/** Send one continuation turn and drain its stream so the provider actually runs. */
async function runContinuationTurn(target: SessionGoalTarget, message: string): Promise<void> {
  const { streamViewSessionTurn } = await import('./sessionBackend')
  const response = await streamViewSessionTurn({
    sessionId: target.sessionId,
    // Name the provider: the audit runs inside the goal's instance scope, but
    // the send path resolves the provider from global config when it is absent.
    provider: target.provider,
    signal: new AbortController().signal,
    body: { message },
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `Continuation rejected (${response.status})`)
  }
  const reader = response.body?.getReader()
  if (!reader) {
    await response.text().catch(() => '')
    return
  }
  // Nobody is watching this stream: keep pulling so the provider's generator
  // advances, and drop the frames.
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

async function auditGoalProgress(goal: SessionGoal, messages: readonly SessionMessage[]): Promise<SessionGoalAudit> {
  const prompt = buildGoalAuditPrompt({
    goal,
    lastAssistant: lastAssistantText(messages).slice(-LAST_REPLY_MAX),
    lastUser: lastUserText(messages).slice(-LAST_REPLY_MAX),
    transcriptTail: transcriptTail(messages),
  })
  const result = await runStructuredQuery({
    prompt,
    schema: SESSION_GOAL_AUDIT_SCHEMA,
    model: auditModel(),
    signal: AbortSignal.timeout(AUDIT_TIMEOUT_MS),
  })
  const audit = parseSessionGoalAudit(result.structuredOutput ?? parseJsonObject(result.text))
  if (!audit) throw new Error('The auditor returned no usable decision')
  return { ...audit, note: audit.note.slice(0, AUDIT_NOTE_MAX) }
}

/** A compact tail of earlier user/assistant text — no tools, no file contents. */
function transcriptTail(messages: readonly SessionMessage[]): string {
  const lines: string[] = []
  for (const message of messages.slice(-40)) {
    if (message.type !== 'user' && message.type !== 'assistant') continue
    const text = textOfMessage(message)
    if (!text) continue
    lines.push(`${message.type === 'user' ? 'User' : 'Agent'}: ${text.replace(/\s+/g, ' ').slice(0, 400)}`)
  }
  if (lines.length === 0) return ''
  const joined = lines.join('\n')
  return joined.length > 8_000 ? joined.slice(-8_000) : joined
}

/**
 * Pause a live goal because the user interrupted the turn. Targets one account
 * when known; otherwise pauses every live goal on that native session id.
 */
export async function pauseSessionGoalForTurn(sessionId: string, target?: SessionGoalTarget): Promise<void> {
  const note = 'Paused because the turn was interrupted.'
  if (target) {
    const goal = await readSessionGoal(target)
    if (goal?.status === 'active') await patchSessionGoal(target, { status: 'paused', lastNote: note })
    return
  }
  for (const goal of await listSessionGoalsForSessionId(sessionId)) {
    if (goal.status !== 'active') continue
    await patchSessionGoal(goal, { status: 'paused', lastNote: note })
  }
}
