import type { AgentProvider } from './types'

export type SessionBackgroundTask = {
  id: string
  type: string
  status: string
  description: string
}

export type SessionCronWakeup = {
  id: string
  schedule: string
  recurring: boolean
  prompt: string
}

export type WaitingSession = {
  sessionId: string
  provider: AgentProvider
  backgroundTasks: SessionBackgroundTask[]
  sessionCrons: SessionCronWakeup[]
  updatedAt: number
}

type RunningSession = {
  provider: AgentProvider
  interrupt: (cancelQueued?: boolean) => Promise<unknown>
  background?: () => Promise<unknown>
  /**
   * Deliver an additional user message INTO the running turn, the way the
   * provider's own CLI does when you type while the agent works (Claude Code
   * queues it as steering input, Codex `turn/steer`, Pi `steer()`). Absent
   * when the provider has no mid-turn delivery primitive.
   */
  steer?: (text: string) => Promise<unknown>
  requestId?: string
}

const runningSessions = new Map<string, RunningSession>()
const waitingSessions = new Map<string, WaitingSession>()
const pendingInterrupts = new Map<string, { requestId: string; timer: ReturnType<typeof setTimeout> }>()
const PENDING_INTERRUPT_TTL_MS = 30_000

export function setRunningSession(sessionId: string, session: RunningSession): void {
  // A new foreground turn supersedes the prior Stop-hook pause snapshot. The
  // next Stop callback will publish a fresh waiting state if work remains.
  waitingSessions.delete(sessionId)
  runningSessions.set(sessionId, session)
  const pending = pendingInterrupts.get(sessionId)
  if (pending && session.requestId === pending.requestId) {
    clearTimeout(pending.timer)
    pendingInterrupts.delete(sessionId)
    void session.interrupt().catch(() => {})
  }
}

export function setWaitingSession(state: Omit<WaitingSession, 'updatedAt'>): void {
  if (state.backgroundTasks.length === 0 && state.sessionCrons.length === 0) {
    waitingSessions.delete(state.sessionId)
    return
  }
  waitingSessions.set(state.sessionId, { ...state, updatedAt: Date.now() })
}

export function clearWaitingSession(sessionId: string): void {
  waitingSessions.delete(sessionId)
}

export function listWaitingSessions(): WaitingSession[] {
  return [...waitingSessions.values()]
}

export function getRunningSession(sessionId: string): RunningSession | undefined {
  return runningSessions.get(sessionId)
}

export function clearRunningSession(sessionId: string): void {
  runningSessions.delete(sessionId)
}

/**
 * Interrupt the running turn. Resolves to the provider's interrupt receipt
 * when it produces one (Claude interrupt_receipt_v1: `{ still_queued }` uuids
 * of queued async messages that survive the interrupt), undefined otherwise.
 */
export async function interruptRunningSession(sessionId: string, requestId?: string, cancelQueued = false): Promise<unknown> {
  const running = runningSessions.get(sessionId)
  if (running) {
    if (requestId && running.requestId && running.requestId !== requestId) return undefined
    return await running.interrupt(cancelQueued)
  }

  if (!requestId) {
    throw new Error('No running session for this session')
  }

  const existing = pendingInterrupts.get(sessionId)
  if (existing) clearTimeout(existing.timer)
  const timer = setTimeout(() => {
    const pending = pendingInterrupts.get(sessionId)
    if (pending?.requestId === requestId) pendingInterrupts.delete(sessionId)
  }, PENDING_INTERRUPT_TTL_MS)
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as { unref: () => void }).unref()
  }
  pendingInterrupts.set(sessionId, { requestId, timer })
}

/**
 * Try to steer the session's in-flight turn with an extra user message.
 * `delivered: false` means no running turn or no steer primitive — the caller
 * should fall back to queueing the message for the next turn. `messageUuid` is
 * set when the provider stamps the delivered message (Claude), so clients can
 * correlate command_lifecycle frames and interrupt still_queued receipts.
 */
export async function steerRunningSession(sessionId: string, text: string): Promise<{ delivered: boolean; messageUuid?: string }> {
  const running = runningSessions.get(sessionId)
  if (!running?.steer) return { delivered: false }
  const result = await running.steer(text)
  return { delivered: true, messageUuid: typeof result === 'string' ? result : undefined }
}

/**
 * Snapshot of whether a turn is currently running server-side for a session.
 * Used by clients to reattach to a live turn after navigating away or reloading
 * (the turn keeps running with detachOnClientAbort). `process-local`: only
 * reflects turns started in this process.
 */
export function getRunningSessionInfo(sessionId: string): {
  running: boolean
  provider?: AgentProvider
  canSteer: boolean
  canInterrupt: boolean
  canBackground: boolean
} {
  const running = runningSessions.get(sessionId)
  if (!running) return { running: false, canSteer: false, canInterrupt: false, canBackground: false }
  return {
    running: true,
    provider: running.provider,
    canSteer: typeof running.steer === 'function',
    canInterrupt: true,
    canBackground: typeof running.background === 'function',
  }
}

/**
 * Every session with a turn currently running in this process, for surfaces
 * that track liveness across sessions (reattach, attention inbox, fleet view).
 */
export function listRunningSessionRefs(): Array<{ sessionId: string; provider: AgentProvider }> {
  return Array.from(runningSessions, ([sessionId, running]) => ({ sessionId, provider: running.provider }))
}

export async function backgroundRunningSession(sessionId: string): Promise<boolean> {
  const running = runningSessions.get(sessionId)
  if (!running) throw new Error('No running session for this session')
  if (!running.background) throw new Error(`${running.provider} sessions do not support backgrounding running tasks`)
  return Boolean(await running.background())
}
