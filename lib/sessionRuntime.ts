import type { AgentProvider } from './types'

type RunningSession = {
  provider: AgentProvider
  interrupt: () => Promise<unknown>
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
