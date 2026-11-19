import type { PluginSchedulesService } from '../../../lib/plugins/schedules'
import { isRemoteAttached, remoteJson } from '../../../lib/tui/remote'

// Attached, the daemon owns the schedules and fires them; otherwise this process reads
// the same file directly and (in start.tsx) holds the lease that fires them.
const post = (payload: Record<string, unknown>) => remoteJson('/api/schedules', { method: 'POST', body: JSON.stringify(payload) })

export const tuiSchedules: PluginSchedulesService = {
  async list(signal) {
    signal?.throwIfAborted()
    if (isRemoteAttached()) return (await remoteJson<{ schedules: Awaited<ReturnType<PluginSchedulesService['list']>> }>('/api/schedules')).schedules
    return (await import('../../../lib/schedules/service')).listSchedulesWithRuns()
  },
  async setEnabled(id, enabled) {
    if (isRemoteAttached()) { await post({ action: enabled ? 'resume' : 'pause', id }); return }
    ;(await import('../../../lib/schedules/service')).setScheduleEnabled(id, enabled)
  },
  async runNow(id) {
    if (isRemoteAttached()) { await post({ action: 'run-now', id }); return }
    await (await import('../../../lib/schedules/engine')).runScheduleNow(id)
  },
  async create(schedule) {
    if (isRemoteAttached()) { await post({ action: 'create', schedule }); return }
    ;(await import('../../../lib/schedules/service')).createSchedule(schedule)
  },
  async remove(id) {
    if (isRemoteAttached()) { await post({ action: 'delete', id }); return }
    ;(await import('../../../lib/schedules/service')).deleteSchedule(id)
  },
}
