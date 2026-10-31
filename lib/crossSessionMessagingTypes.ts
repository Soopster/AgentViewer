import type { AgentProvider } from './types'

export type AddressableSession = {
  sessionId: string
  provider: AgentProvider
  name: string
  cwd?: string
  title?: string
  running: boolean
}

export type SendCrossSessionMessageResult = {
  delivered: boolean
  mode: 'steered' | 'queued' | 'not_found' | 'error' | 'throttled'
  targetSessionId?: string
  targetProvider?: AgentProvider
  targetName?: string
  error?: string
}

