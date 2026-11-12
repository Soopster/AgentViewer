import type { SessionIdentity } from '../sessionIdentity'
import type { SessionDiagnosticSection } from '../types'

/** Runtime reads and controls, bound to an explicit provider-instance identity. */
export type PluginSessionDiagnosticsService = {
  readonly read: (session: Readonly<SessionIdentity>, signal?: AbortSignal) => Promise<SessionDiagnosticSection[]>
  readonly run: (session: Readonly<SessionIdentity>, action: string, extra: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>
  readonly hasControls: (session: Readonly<SessionIdentity>) => boolean
}
