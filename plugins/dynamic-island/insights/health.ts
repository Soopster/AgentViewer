import type { ActivityInput } from '../../../lib/plugins/activityFeed'
import type { PluginSessionRef } from '../../../lib/plugins/bookmarks'

export const HEALTH_SOURCE = 'health'
/** A turn this long is worth a look; most finish well inside it. */
export const LONG_TURN_MS = 20 * 60_000

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * Turns that have been running a long time. `since` is when each began; a host that cannot
 * say passes nothing, and the caller falls back to when it first saw the turn running.
 * Only a running turn qualifies: one waiting on the user is already an approval row.
 */
export function healthActivities(
  activity: ReadonlyMap<string, 'needs-input' | 'running' | 'waiting'>,
  since: ReadonlyMap<string, number>,
  titles: ReadonlyMap<string, string>,
  targets: ReadonlyMap<string, PluginSessionRef>,
  now: number,
): ActivityInput[] {
  const rows: ActivityInput[] = []
  for (const [key, state] of activity) {
    const began = since.get(key)
    if (state !== 'running' || began === undefined || now - began < LONG_TURN_MS) continue
    // Bucketed to the minute-of-five so the row text changes rarely and polls stay identical.
    const elapsed = Math.floor((now - began) / 300_000) * 300_000
    rows.push({
      id: `health:long:${key}`, source: HEALTH_SOURCE, kind: 'health', status: 'waiting',
      title: `${titles.get(key) || 'Agent session'} has run ${formatDuration(elapsed)}`,
      detail: 'Long turn — check it is progressing rather than stuck',
      target: targets.get(key), updatedAt: began,
    })
  }
  return rows
}
