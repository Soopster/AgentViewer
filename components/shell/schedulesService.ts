import type { PluginSchedulesService } from '../../lib/plugins/schedules'

export function createWebSchedulesService(fetcher: typeof fetch = (...args) => fetch(...args)): PluginSchedulesService {
  const post = async (payload: Record<string, unknown>) => {
    const response = await fetcher('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body?.error || `Schedules answered ${response.status}`)
  }
  return {
    async list(signal) {
      const response = await fetcher('/api/schedules', { signal })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !Array.isArray(body?.schedules)) throw new Error(body?.error || 'Failed to load schedules')
      return body.schedules
    },
    setEnabled: (id, enabled) => post({ action: enabled ? 'resume' : 'pause', id }),
    runNow: id => post({ action: 'run-now', id }),
    remove: id => post({ action: 'delete', id }),
    create: schedule => post({ action: 'create', schedule }),
  }
}

export const webSchedules = createWebSchedulesService()
