import type { AgentProvider, RunningSessionRef } from './types'

type RunningSession = {
  provider: AgentProvider
  interrupt: () => Promise<unknown>
}

const runningSessions = new Map<string, RunningSession>()

export function setRunningSession(sessionId: string, session: RunningSession): void {
  runningSessions.set(sessionId, session)
}

export function getRunningSession(sessionId: string): RunningSession | undefined {
  return runningSessions.get(sessionId)
}

export function clearRunningSession(sessionId: string): void {
  runningSessions.delete(sessionId)
}

export function listRunningSessions(): RunningSessionRef[] {
  return [...runningSessions.entries()].map(([sessionId, session]) => ({
    sessionId,
    provider: session.provider,
  }))
}
