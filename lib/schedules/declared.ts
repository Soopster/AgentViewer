import type { PluginManifest } from '../plugins/types'
import { nextTriggerFire } from './cron'
import { updateScheduleState } from './store'
import type { Schedule } from './types'

/**
 * Registers the schedules plugins declare, disabled. Idempotent, and a user's edits
 * (enabled, trigger, prompt) survive: an existing entry is never rewritten. An entry
 * whose plugin stopped declaring it is removed, so a removed plugin leaves no timers.
 */
export function declaredScheduleId(pluginId: string, id: string): string {
  return `${pluginId}:${id}`
}

export function syncDeclaredSchedules(manifests: readonly Pick<PluginManifest, 'id' | 'schedules'>[], now = Date.now()): { added: string[]; removed: string[] } {
  const wanted = new Map<string, { pluginId: string; spec: NonNullable<PluginManifest['schedules']>[number] }>()
  for (const manifest of manifests) {
    for (const spec of manifest.schedules ?? []) wanted.set(declaredScheduleId(manifest.id, spec.id), { pluginId: manifest.id, spec })
  }
  const added: string[] = []
  const removed: string[] = []
  updateScheduleState(state => {
    const kept: Schedule[] = []
    for (const schedule of state.schedules) {
      if (schedule.source && !wanted.has(schedule.id)) { removed.push(schedule.id); continue }
      kept.push(schedule)
    }
    for (const [id, { pluginId, spec }] of wanted) {
      if (kept.some(schedule => schedule.id === id)) continue
      kept.push({
        id,
        name: spec.name,
        trigger: spec.trigger,
        action: spec.action,
        prompt: spec.prompt,
        overlap: 'skip',
        catchUp: 'skip',
        enabled: false,
        createdAt: now,
        source: pluginId,
        nextRunAt: nextTriggerFire(spec.trigger, now) ?? undefined,
      })
      added.push(id)
    }
    state.schedules = kept
    state.runs = state.runs.filter(run => kept.some(schedule => schedule.id === run.scheduleId))
  })
  return { added, removed }
}
