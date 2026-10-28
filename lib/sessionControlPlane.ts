import { getRunningSessionInfo } from './sessionRuntime'
import { readPendingTurnPermissions, readPendingTurnPrompts } from './sessionActivity'
import type { AgentProvider } from './types'

export function listPendingProviderPermissionPayloads(sessionId: string, provider?: AgentProvider) {
  return readPendingTurnPermissions(sessionId, provider)
}

export function readViewSessionRunning(sessionId: string): ReturnType<typeof getRunningSessionInfo> & {
  pendingPrompts: Record<string, unknown>[]
  pendingPermissions: Record<string, unknown>[]
} {
  const info = getRunningSessionInfo(sessionId)
  return { ...info, pendingPrompts: readPendingTurnPrompts(sessionId, info.provider),
    pendingPermissions: readPendingTurnPermissions(sessionId, info.provider) }
}
