import type { PluginProvenanceService } from '../../../lib/plugins/provenance'

/** In process: the provenance index is local to the TUI. */
export const tuiProvenance: PluginProvenanceService = {
  async sessionFiles(session, signal) {
    signal?.throwIfAborted()
    const { sessionProvenanceSummary } = await import('../../../lib/provenance')
    return sessionProvenanceSummary(session.provider, session.sessionId)
  },
  async blame(file, cwd, signal) {
    signal?.throwIfAborted()
    const { blameFileProvenance } = await import('../../../lib/provenance')
    return blameFileProvenance({ file, cwd })
  },
}
