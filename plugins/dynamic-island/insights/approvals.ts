import type { ActivityAction, ActivityInput } from '../../../lib/plugins/activityFeed'
import type { PluginSessionRef } from '../../../lib/plugins/bookmarks'
import type { PendingPermission } from '../../../lib/permissions'

export const APPROVALS_SOURCE = 'approvals'
const DETAIL_MAX = 160

type Respond = (target: PluginSessionRef, permissionId: string, response: 'once' | 'reject') => Promise<void>

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const clip = (text: string) => text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text

/** What the ask wants to do, in the words a person would use to decide. */
function summarize(ask: PendingPermission): string {
  const what = ask.command ?? ask.paths?.join(', ') ?? ask.url ?? ask.detail ?? ask.title
  return clip(oneLine(ask.toolName && what !== ask.title ? `${ask.toolName}: ${what}` : what))
}

/**
 * One row per unanswered ask. A plain permission can be answered here; a question, a plan
 * or an elicitation needs the transcript's picker, so those only open their session.
 * Approve is never primary on an ask the provider said must not be one keystroke away.
 */
export function approvalActivities(
  pending: ReadonlyMap<string, readonly PendingPermission[]>,
  titles: ReadonlyMap<string, string>,
  targets: ReadonlyMap<string, PluginSessionRef>,
  respond: Respond,
  now: number,
): ActivityInput[] {
  const rows: ActivityInput[] = []
  for (const [key, asks] of pending) {
    const target = targets.get(key)
    for (const ask of asks) {
      const answerable = !ask.questions?.length && !ask.elicitation && ask.plan === undefined
      const decide = (response: 'once' | 'reject') => async () => { if (target) await respond(target, ask.id, response) }
      const actions: ActivityAction[] = answerable && target ? [
        { id: 'reject', label: 'Reject', tone: ask.defaultToDeny ? 'primary' : 'danger', run: decide('reject') },
        { id: 'approve', label: 'Approve', tone: ask.defaultToDeny ? undefined : 'primary', run: decide('once') },
      ] : []
      rows.push({
        id: `approval:${key}:${ask.id}`, source: APPROVALS_SOURCE, kind: answerable ? 'approval' : 'question',
        status: 'needs-input', title: `${titles.get(key) || 'Agent session'} needs ${answerable ? 'approval' : 'an answer'}`,
        detail: answerable ? summarize(ask) : clip(oneLine(ask.title)),
        target, actions, updatedAt: now,
      })
    }
  }
  return rows
}
