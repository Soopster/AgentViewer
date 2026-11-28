import type { ActivityAction, AppActivity } from '../../lib/plugins/activityFeed'
import type { PluginActivityControl } from '../../lib/plugins/activityControl'

const STATUS_PROMPT = 'Give me a short status: what you are doing now, what is left, and whether anything is blocking you.'
const COMMIT_PROMPT = 'Review the uncommitted changes, then commit them with a clear message. Leave out anything that does not belong in the commit and tell me what you left out.'

/**
 * Every action a row offers: the ones its producer attached (answering an ask), then the
 * ones that fit what happened. Nothing here sends a prompt; text goes to the composer for
 * the person to read first, and anything that ends work needs a second press.
 */
export function activityActions(item: AppActivity, control: PluginActivityControl | undefined): readonly ActivityAction[] {
  return [...(item.actions ?? []), ...(control ? fitting(item, control) : [])]
}

function fitting(item: AppActivity, control: PluginActivityControl): ActivityAction[] {
  const target = item.target
  const draft = (id: string, key: string, label: string, text: string): ActivityAction =>
    ({ id, key, label, leaves: true, run: () => control.draft(target, text) })
  const view = (id: string, key: string, label: string, command: string): ActivityAction =>
    ({ id, key, label, leaves: true, run: () => control.open(command, target) })
  const checks = item.context?.checks
  if (checks) {
    const rerun: ActivityAction = { id: 'rerun', key: 'c', label: checks.failing.length ? 'Rerun failed' : 'Rerun checks', done: 'Checks started',
      run: () => control.rerunChecks(checks.cwd, checks.ids, checks.version) }
    return [
      ...(checks.failing.length ? [draft('fix', 'f', 'Draft fix', `These checks are failing in ${checks.cwd}: ${checks.failing.join(', ')}. Run them, find the cause and fix it, then rerun them and report what is still unverified.`)] : []),
      rerun, view('proof', 'v', 'Open Proof', 'proof'),
    ]
  }
  if (item.kind === 'repo') return [view('diff', 'v', 'Review diff', 'git'), draft('commit', 'm', 'Draft commit', COMMIT_PROMPT)]
  if (item.kind === 'team') return target ? [view('teammates', 't', 'Open Teammates', 'coord-teammates')] : []
  if (item.kind === 'task') {
    const taskId = item.context?.taskId
    if (item.status === 'error') return [draft('investigate', 'f', 'Investigate', `The background task "${item.title}" failed${item.detail ? `: ${item.detail}` : ''}. Find out why and tell me before changing anything.`)]
    return target?.provider === 'claude' && taskId
      ? [{ id: 'stop-task', key: 's', label: 'Stop task', tone: 'danger', confirm: true, done: 'Task stopped', run: () => control.stopTask(target, taskId) }] : []
  }
  const stop: ActivityAction[] = target
    ? [{ id: 'stop', key: 's', label: 'Stop turn', tone: 'danger', confirm: true, done: 'Stop requested', run: () => control.interrupt(target) }] : []
  if (item.kind === 'health') return target ? [draft('status', 'p', 'Ask for status', STATUS_PROMPT), ...stop] : []
  const turn = item.context?.turn
  if (turn && target) {
    if (turn === 'running') return [draft('message', 'm', 'Message', ''), ...stop]
    if (turn === 'ended') return [draft('message', 'm', 'Reply', ''), view('diff', 'v', 'Review changes', 'git')]
    return [draft('message', 'm', turn === 'needs-input' ? 'Reply' : 'Message', ''), ...(turn === 'needs-input' ? stop : [])]
  }
  // A failure from any other source: hand it to the agent.
  if (!item.kind && item.status === 'error') return [draft('investigate', 'f', 'Ask agent', `${item.title}${item.detail ? `\n\n${item.detail}` : ''}\n\nFind out why this happened.`)]
  return []
}

/** What opening the row is for. */
export function openLabel(item: AppActivity): string {
  return item.kind === 'plan' ? 'Review plan' : item.kind === 'question' ? 'Answer in session' : 'Open session'
}
