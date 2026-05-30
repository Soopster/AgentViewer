import type { AgentProvider } from './types'

type RunningSession = {
  provider: AgentProvider
  interrupt: () => Promise<unknown>
}

const runningSessions = new Map<string, RunningSession>()
const pendingInterrupts = new Map<string, ReturnType<typeof setTimeout>>()
const PENDING_INTERRUPT_TTL_MS = 30_000

export function setRunningSession(sessionId: string, session: RunningSession): void {
  runningSessions.set(sessionId, session)
  const pendingTimer = pendingInterrupts.get(sessionId)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingInterrupts.delete(sessionId)
    void session.interrupt().catch(() => {})
  }
}

export function getRunningSession(sessionId: string): RunningSession | undefined {
  return runningSessions.get(sessionId)
}

export function clearRunningSession(sessionId: string): void {
  runningSessions.delete(sessionId)
  const pendingTimer = pendingInterrupts.get(sessionId)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingInterrupts.delete(sessionId)
  }
}

export async function interruptRunningSession(sessionId: string): Promise<void> {
  const running = runningSessions.get(sessionId)
  if (running) {
    await running.interrupt()
    return
  }

  const existing = pendingInterrupts.get(sessionId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    pendingInterrupts.delete(sessionId)
  }, PENDING_INTERRUPT_TTL_MS)
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as { unref: () => void }).unref()
  }
  pendingInterrupts.set(sessionId, timer)
}
