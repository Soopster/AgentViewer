import type { PluginPstackService } from '../../../lib/plugins/pstack'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'

// Attached, the daemon runs the turns, so its roles are the ones that apply.
export const tuiPstack: PluginPstackService = {
  async read(cwd, signal) {
    signal?.throwIfAborted()
    if (isRemoteAttached()) return remoteJson(`/api/pstack?cwd=${encodeURIComponent(cwd)}`)
    return (await import('../../../lib/pstack/service')).readPstack(cwd)
  },
  async saveRole(cwd, role, line) {
    if (isRemoteAttached()) return remoteJson('/api/pstack', { method: 'POST', body: JSON.stringify({ cwd, role, line }) })
    return (await import('../../../lib/pstack/service')).savePstackRole(cwd, role, line)
  },
}
