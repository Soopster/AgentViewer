// The TUI's session-insights service: the index in this process, or the
// daemon's when attached (lib/tui/service routes both).
import type { PluginSessionInsightsService } from '../../../lib/plugins/sessionInsights'
import { readTuiSessionProvenance, searchTuiSessionIndex } from '../../../lib/tui/service'

export const tuiSessionInsights: PluginSessionInsightsService = {
  provenance: (session) => readTuiSessionProvenance(session.provider, session.sessionId),
  search: (params) => searchTuiSessionIndex(params),
}
