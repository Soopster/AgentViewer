import type { ActivityInput } from '../../../lib/plugins/activityFeed'
import type { PluginSessionRef } from '../../../lib/plugins/bookmarks'

export const TEAM_SOURCE = 'team'

/** Teammates waiting on the lead, per conversation. `finished` results are history, not a decision, so they never raise a row. */
export function teamActivities(
  teams: ReadonlyMap<string, { readonly waiting: number; readonly finished: number }>,
  titles: ReadonlyMap<string, string>,
  targets: ReadonlyMap<string, PluginSessionRef>,
  now: number,
): ActivityInput[] {
  const rows: ActivityInput[] = []
  for (const [key, mark] of teams) {
    if (mark.waiting <= 0) continue
    const title = titles.get(key) || 'Agent session'
    rows.push({
      id: `team:${key}`, source: TEAM_SOURCE, kind: 'team', status: 'needs-input',
      title: `${title}: ${mark.waiting} teammate${mark.waiting === 1 ? '' : 's'} waiting on you`,
      detail: mark.finished > 0 ? `${mark.finished} finished result${mark.finished === 1 ? '' : 's'} to review` : 'Open the conversation, then Teammates, to answer',
      target: targets.get(key), updatedAt: now,
      // Dismissed until MORE teammates wait; reviewing results or a retitled session must not bring it back.
      dismissKey: `waiting:${mark.waiting}`,
    })
  }
  return rows
}
