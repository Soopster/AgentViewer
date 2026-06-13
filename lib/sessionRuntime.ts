import type { AgentProvider } from './types'

type RunningSession = {
  provider: AgentProvider
  interrupt: () => Promise<unknown>
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
const pendingInterrupts = new Map<string, { requestId: string; timer: ReturnType<typeof setTimeout> }>()
const PENDING_INTERRUPT_TTL_MS = 30_000

export function setRunningSession(sessionId: string, session: RunningSession): void {
  runningSessions.set(sessionId, session)
  const pending = pendingInterrupts.get(sessionId)
  if (pending && session.requestId === pending.requestId) {
    clearTimeout(pending.timer)
    pendingInterrupts.delete(sessionId)
    void session.interrupt().catch(() => {})
  }
}

export function getRunningSession(sessionId: string): RunningSession | undefined {
  return runningSessions.get(sessionId)
}

export function clearRunningSession(sessionId: string): void {
  runningSessions.delete(sessionId)
}

export async function interruptRunningSession(sessionId: string, requestId?: string): Promise<void> {
  const running = runningSessions.get(sessionId)
  if (running) {
    if (requestId && running.requestId && running.requestId !== requestId) return
    await running.interrupt()
    return
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
 * Returns false when there is no running turn or the provider can't steer —
 * the caller should fall back to queueing the message for the next turn.
 */
export async function steerRunningSession(sessionId: string, text: string): Promise<boolean> {
  const running = runningSessions.get(sessionId)
  if (!running?.steer) return false
  await running.steer(text)
  return true
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

export async function backgroundRunningSession(sessionId: string): Promise<boolean> {
  const running = runningSessions.get(sessionId)
  if (!running) throw new Error('No running session for this session')
  if (!running.background) throw new Error(`${running.provider} sessions do not support backgrounding running tasks`)
  return Boolean(await running.background())
}
