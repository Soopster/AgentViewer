import type { PluginChiefOfStaffService } from '../../../lib/plugins/chiefOfStaff'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'

// Attached, the daemon owns the Chief of Staff's team; otherwise this process runs it in place.
export const tuiChiefOfStaff: PluginChiefOfStaffService = {
  async read(cwd, signal) {
    signal?.throwIfAborted()
    if (isRemoteAttached()) return remoteJson(`/api/chief-of-staff?cwd=${encodeURIComponent(cwd)}`)
    return (await import('../../../lib/chiefOfStaff/service')).readChiefOfStaff(cwd)
  },
  async start(params) {
    if (isRemoteAttached()) return remoteJson('/api/chief-of-staff', { method: 'POST', body: JSON.stringify(params) })
    return (await import('../../../lib/chiefOfStaff/service')).startChiefOfStaff(params)
  },
  async saveRules(cwd, rules) {
    if (isRemoteAttached()) return remoteJson('/api/chief-of-staff', { method: 'POST', body: JSON.stringify({ action: 'save-rules', cwd, rules }) })
    return (await import('../../../lib/chiefOfStaff/service')).saveChiefOfStaffRules(cwd, rules)
  },
}
