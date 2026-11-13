// Code provenance as a plugin service: what a session wrote, and which agent
// sessions wrote a file's current lines. Browser-safe types only.
import type { ProvenanceBlameResult, SessionProvenanceResult } from '../provenance'
import type { AgentProvider } from '../types'

export type PluginProvenanceService = {
  readonly sessionFiles: (session: { provider: AgentProvider; sessionId: string }, signal?: AbortSignal) => Promise<SessionProvenanceResult>
  readonly blame: (file: string, cwd: string | null, signal?: AbortSignal) => Promise<ProvenanceBlameResult>
}
