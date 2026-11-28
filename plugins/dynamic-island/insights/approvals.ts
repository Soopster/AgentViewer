import type { ActivityAction, ActivityInput } from '../../../lib/plugins/activityFeed'
import type { PluginSessionRef } from '../../../lib/plugins/bookmarks'
import type { PendingPermission } from '../../../lib/permissions'
import type { PluginPermissionsService } from '../../../lib/plugins/application'

export const APPROVALS_SOURCE = 'approvals'
const DETAIL_MAX = 160

/** More choices than this need the transcript's picker, which can show their descriptions. */
const INLINE_OPTIONS_MAX = 4

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()
const clip = (text: string) => text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text

/** What the ask wants to do, in the words a person would use to decide. */
function summarize(ask: PendingPermission): string {
  const what = ask.command ?? ask.paths?.join(', ') ?? ask.url ?? ask.detail ?? ask.title
  return clip(oneLine(ask.toolName && what !== ask.title ? `${ask.toolName}: ${what}` : what))
}

/** A single pick from a short list is the only question that can be answered from a row. */
function inlineQuestion(ask: PendingPermission) {
  const question = ask.questions?.length === 1 ? ask.questions[0] : undefined
  if (!question || ask.asyncQuestion || ask.elicitation || ask.plan !== undefined || question.multiSelect || question.secret || question.externalUrl) return null
  return question.options.length > 0 && question.options.length <= INLINE_OPTIONS_MAX ? question : null
}

/**
 * One row per unanswered ask. A plain permission or a short single-choice question can be
 * answered here; a longer question, a plan or an elicitation needs the transcript's picker,
 * so those only open their session. Approve is never primary on an ask the provider said
 * must not be one keystroke away, and Always is not offered for one.
 */
export function approvalActivities(
  pending: ReadonlyMap<string, readonly PendingPermission[]>,
  titles: ReadonlyMap<string, string>,
  targets: ReadonlyMap<string, PluginSessionRef>,
  permissions: PluginPermissionsService,
  now: number,
): ActivityInput[] {
  const rows: ActivityInput[] = []
  for (const [key, asks] of pending) {
    const target = targets.get(key)
    for (const ask of asks) {
      const answerable = !ask.questions?.length && !ask.elicitation && ask.plan === undefined
      const question = inlineQuestion(ask)
      const decide = (response: 'once' | 'always' | 'reject') => async () => { if (target) await permissions.respond(target, ask.id, response) }
      const actions: ActivityAction[] = !target ? [] : answerable ? [
        { id: 'reject', key: 'r', label: 'Reject', tone: ask.defaultToDeny ? 'primary' : 'danger', run: decide('reject') },
        { id: 'approve', key: 'a', label: 'Approve', tone: ask.defaultToDeny ? undefined : 'primary', run: decide('once') },
        ...(ask.canApproveAlways !== false && !ask.defaultToDeny
          ? [{ id: 'always', key: 'A', label: 'Always', confirm: true, run: decide('always') } as const] : []),
      ] : question ? question.options.map((option, index) => ({
        id: `answer:${index}`, key: String(index + 1), label: clip(oneLine(option.label)),
        run: () => permissions.answer(target, ask.id, { [question.id ?? question.question]: [option.value ?? option.label] }),
      })) : []
      rows.push({
        id: `approval:${key}:${ask.id}`, source: APPROVALS_SOURCE, kind: answerable ? 'approval' : ask.plan !== undefined ? 'plan' : 'question',
        status: 'needs-input', title: `${titles.get(key) || 'Agent session'} ${answerable ? 'needs approval' : ask.plan !== undefined ? 'has a plan to review' : 'needs an answer'}`,
        detail: answerable ? summarize(ask) : clip(oneLine(question?.question ?? ask.title)),
        target, actions, updatedAt: now,
      })
    }
  }
  return rows
}
