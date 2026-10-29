import type { CoordinatorBriefBlock, CoordinatorMailBlock, ToolThread } from '../../lib/threading'
import type { TuiTranscriptCardLine, TuiTranscriptLineTone } from './types'
import { MAX_PREVIEW_CHARS, MAX_BLOCK_LINES, line, compactLines, compactOneLine, truncateLine, sanitizeLine } from './text'
import { canonicalToolName, normalizedToolKey, mcpToolIdForThread, toolInputRecord, toolStringParam, extractResultText } from './tools'

// A Coordinator call reaches a transcript three ways: as an MCP tool
// (`mcp__agent-viewer__coord_status`), as a bare tool where the provider drops
// the server prefix (Codex: `coord_status`, arguments under `value`), and — in
// a conversation that predates the binding — as a shell command running the
// session-bound client (`bun client.mjs <binding>.json coord_status '{}'`).
// All three are the same call and read as one.
type CoordinatorCall = { toolName: string; input: Record<string, unknown>; shell: boolean }

const COORDINATOR_SHELL_CALL = /client\.mjs\\?['"]?\s+\\?['"]?[^\s'"]+\.json\\?['"]?\s+(coord_[a-z_]+)\b\s*([\s\S]*)$/

function coordinatorShellArguments(rest: string): Record<string, unknown> {
  const start = rest.indexOf('{')
  const end = rest.lastIndexOf('}')
  if (start < 0 || end <= start) return {}
  const raw = rest.slice(start, end + 1)
  // Inside a `zsh -lc "…"` wrapper the argument's own quotes arrive escaped.
  for (const candidate of [raw, raw.replace(/\\"/g, '"'), raw.replace(/'\\''/g, "'")]) {
    const parsed = parseJsonValue(candidate)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  }
  return {}
}

export function coordinatorCall(thread: ToolThread): CoordinatorCall | null {
  const input = toolInputRecord(thread)
  const id = mcpToolIdForThread(thread)
  const key = normalizedToolKey(id?.tool ?? thread.toolUse.name)
  if (key.startsWith('coord_')) {
    const value = input.value
    return {
      toolName: key,
      input: value && typeof value === 'object' && !Array.isArray(value) ? { ...input, ...(value as Record<string, unknown>) } : input,
      shell: false,
    }
  }
  if (canonicalToolName(thread.toolUse.name) !== 'Bash') return null
  const command = toolStringParam(input, ['command', 'cmd', 'script'])
  // The pattern ends in `[\s\S]*$`, so it is retried across the whole command;
  // every match contains the literal it starts with.
  const match = command && command.includes('client.mjs') ? COORDINATOR_SHELL_CALL.exec(command) : null
  return match ? { toolName: match[1]!, input: coordinatorShellArguments(match[2] ?? ''), shell: true } : null
}

function coordinatorActionLabel(toolName: string): string {
  const labels: Record<string, string> = {
    coord_create_run: 'create run',
    coord_join_run: 'join run',
    coord_list_runs: 'list runs',
    coord_resume: 'resume',
    coord_status: 'status',
    coord_wait: 'wait',
    coord_create_task: 'create task',
    coord_claim_task: 'claim task',
    coord_release_task: 'release task',
    coord_read_inbox: 'inbox',
    coord_send_message: 'send message',
    coord_handoff_task: 'handoff task',
    coord_request_locks: 'request locks',
    coord_progress: 'progress',
    coord_publish_finding: 'publish finding',
    coord_submit_plan: 'submit plan',
    coord_review_plan: 'review plan',
    coord_complete_task: 'complete task',
    coord_fail_task: 'fail task',
    coord_finalize_run: 'finalize run',
    coord_spawn_teammate: 'spawn teammate',
  }
  return labels[toolName] ?? toolName.slice('coord_'.length).replace(/_/g, ' ')
}

// One header per call, shaped as `verb[ → who][ · qualifier…][  what was said]`.
// Both TUIs print it as text; the OpenTUI renderer also reads that shape back
// to colour it (`coordinatorHeaderSegments`), so the two spaces before the
// free text and the ` · ` between qualifiers are part of the format.
function coordinatorHeader(toolName: string, input: Record<string, unknown>): string | null {
  const str = (key: string) => typeof input[key] === 'string' && (input[key] as string).trim() ? (input[key] as string).trim() : ''
  const list = (key: string) => Array.isArray(input[key]) ? (input[key] as unknown[]).filter((entry): entry is string => typeof entry === 'string') : []
  const said = (keys: string[], max = 110) => {
    const value = toolStringParam(input, keys)
    return value ? `  ${compactOneLine(value, max)}` : ''
  }
  const meta = (...parts: string[]) => parts.filter(Boolean).map((part) => ` · ${part}`).join('')
  const task = str('task_id')
  const verdict = input.approved === false ? 'reject' : 'approve'
  const model = [str('requested_provider'), str('requested_model'), str('requested_effort')].filter(Boolean).join(' ')
  switch (toolName) {
    case 'coord_status': return 'status'
    case 'coord_read_inbox': return `inbox${meta(input.unresolved === true ? 'unresolved' : '', input.acknowledge === false ? 'peek' : '')}`
    case 'coord_wait': {
      const until = list('until')
      const timeout = typeof input.timeout_ms === 'number' ? `${Math.round(input.timeout_ms / 1000)}s` : ''
      return `wait${str('agent') ? ` → ${str('agent')}` : ''}${meta(until.length ? `until ${until.join('/')}` : '', timeout)}`
    }
    case 'coord_send_message':
      return `message → ${str('to') || '?'}${meta(str('kind'), input.reply_required === true ? 'reply required' : '', str('priority') === 'urgent' ? 'urgent' : '', str('in_reply_to') ? 'reply' : '')}${said(['message', 'body'])}`
    case 'coord_delegate':
      return `delegate → ${str('to') || str('name') || 'a teammate'}${meta(model)}${said(['title', 'detail'])}`
    case 'coord_create_task':
      return `create task${str('assign_to') ? ` → ${str('assign_to')}` : ''}${meta(str('phase'), model)}${said(['title', 'detail'])}`
    case 'coord_claim_task': return `claim ${task || 'next task'}`
    case 'coord_release_task': return `release ${task}${said(['reason'])}`
    case 'coord_handoff_task': return `handoff ${task}${meta(str('failure_class').replace(/_/g, ' '))}${said(['summary', 'detail'])}`
    case 'coord_complete_task': {
      const files = list('files_changed').length
      return `complete ${task}${meta(files ? `${files} file${files === 1 ? '' : 's'}` : '')}${said(['summary', 'detail'])}`
    }
    case 'coord_fail_task': return `fail ${task}${said(['summary', 'detail'])}`
    case 'coord_progress': return `progress${meta(str('status'), task)}${said(['summary', 'detail'])}`
    case 'coord_publish_finding': return `${str('kind') === 'review.requested' ? 'review request' : str('kind') || 'finding'}${meta(task)}${said(['summary', 'detail'])}`
    case 'coord_query_context': return `query${said(['query'])}`
    case 'coord_remember': return `remember${said(['summary', 'detail'])}`
    case 'coord_request_locks': {
      const paths = list('paths')
      return `locks${paths.length ? `  ${paths.slice(0, 2).join(', ')}${paths.length > 2 ? ` +${paths.length - 2}` : ''}` : ''}`
    }
    case 'coord_submit_plan': return `plan ${task}${said(['summary', 'detail'])}`
    case 'coord_review_plan': return `${verdict} plan ${task}${said(['summary', 'detail'])}`
    case 'coord_review_phase': return `${verdict} phase${meta(str('phase'))}${said(['summary', 'detail'])}`
    case 'coord_review_run': return `${verdict} run${said(['summary', 'detail'])}`
    case 'coord_resolve_decision': return `${input.deferred === true ? 'defer' : 'decide'} ${task}${said(['answer'])}`
    case 'coord_finalize_run': return `finalize${said(['summary'])}`
    case 'coord_spawn_teammate': return `spawn teammate${meta(str('provider'))}`
    case 'coord_cancel_turn': return `interrupt → ${str('agent_id') || '?'}`
    case 'coord_leave_run': return `leave${said(['reason'])}`
    case 'coord_capabilities': return `capabilities${meta(str('provider'))}`
    case 'coord_read_handoff': return `read handoff ${str('handoff_id')}`
    case 'coord_save_role': return `save role${said(['name'])}`
    case 'coord_promote_learning': return `promote learning → ${str('target').replace(/_/g, ' ') || '?'}`
    default: return null
  }
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function coordinatorResultText(thread: ToolThread, shell = false): string {
  const raw = extractResultText(thread.result?.content).trim()
  if (shell) {
    // A shell result is the client's stdout, possibly inside the provider's
    // own framing; the payload is the JSON object it printed.
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    return start >= 0 && end > start ? raw.slice(start, end + 1) : raw
  }
  const envelope = parseJsonValue(raw)
  if (!envelope || typeof envelope !== 'object') return raw
  // MCP wraps the payload as `{ content: [{ text }] }`; Codex hands back the
  // content array itself, typed `inputText`.
  const content = Array.isArray(envelope) ? envelope : (envelope as Record<string, unknown>).content
  if (!Array.isArray(content)) return raw
  const text = content.flatMap((entry): string[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const value = (entry as Record<string, unknown>).text
    return typeof value === 'string' ? [value] : []
  }).join('\n').trim()
  return text || raw
}

function coordinatorInputSummary(input: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (key === 'server' || key === 'request_id' || key === 'value' || value == null) continue
    // Codex includes the MCP transport status beside the actual arguments.
    if (key === 'status' && (value === 'completed' || value === 'inProgress' || value === 'failed')) continue
    if (typeof value === 'string') parts.push(`${key.replace(/_/g, ' ')} ${compactOneLine(value, 48)}`)
    else if (typeof value === 'number' || typeof value === 'boolean') parts.push(`${key.replace(/_/g, ' ')} ${String(value)}`)
    else if (Array.isArray(value)) parts.push(`${key.replace(/_/g, ' ')} ${value.length}`)
  }
  return parts.slice(0, 3).join(' · ')
}

// The digest every mutation answers with: where the run is and how its tasks
// stand. "running · 3 tasks · 2 active · 1 done" is the whole of what a reader
// wants from the kilobyte of JSON it arrives in.
function coordinatorRunDigest(payload: Record<string, unknown>): string {
  const parts: string[] = []
  if (typeof payload.runStatus === 'string') parts.push(payload.runStatus)
  const totals = { total: 0, pending: 0, active: 0, completed: 0, failed: 0 }
  for (const phase of Array.isArray(payload.phases) ? payload.phases : []) {
    if (!phase || typeof phase !== 'object') continue
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      const value = (phase as Record<string, unknown>)[key]
      if (typeof value === 'number') totals[key] += value
    }
  }
  if (totals.total > 0) {
    parts.push(`${totals.total} task${totals.total === 1 ? '' : 's'}`)
    if (totals.pending) parts.push(`${totals.pending} pending`)
    if (totals.active) parts.push(`${totals.active} active`)
    if (totals.completed) parts.push(`${totals.completed} done`)
    if (totals.failed) parts.push(`${totals.failed} failed`)
  }
  return parts.join(' · ')
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

// What the caller is now on the hook for, from the `actionable` digest every
// result carries. Ordered by urgency: these are the words the renderer colours.
function coordinatorObligations(actionable: Record<string, unknown> | null): string[] {
  if (!actionable) return []
  const count = (key: string) => typeof actionable[key] === 'number' ? actionable[key] as number : 0
  const plans = Array.isArray(actionable.plansAwaitingReview) ? actionable.plansAwaitingReview.length : 0
  const claimable = Array.isArray(actionable.claimableTasks) ? actionable.claimableTasks.length : 0
  const overlaps = Array.isArray(actionable.overlapWarnings) ? actionable.overlapWarnings.length : 0
  const mine = record(actionable.myTask)
  return [
    count('replyRequiredCount') ? `${count('replyRequiredCount')} repl${count('replyRequiredCount') === 1 ? 'y' : 'ies'} owed` : '',
    count('urgentCount') ? `${count('urgentCount')} urgent` : '',
    count('inboxCount') ? `${count('inboxCount')} unread` : '',
    plans ? `${plans} plan${plans === 1 ? '' : 's'} to review` : '',
    overlaps ? `${overlaps} overlap${overlaps === 1 ? '' : 's'}` : '',
    mine && typeof mine.id === 'string' ? `mine ${mine.id}${typeof mine.status === 'string' ? ` ${mine.status.replace(/_/g, ' ')}` : ''}` : '',
    claimable ? `${claimable} claimable` : '',
    actionable.allTasksTerminal === true ? 'all tasks finished' : '',
  ].filter(Boolean)
}

function coordinatorTaskCounts(payload: Record<string, unknown>, snapshot: Record<string, unknown> | null): string[] {
  const digest = coordinatorRunDigest(payload)
  if (digest) return [digest]
  const run = record(snapshot?.run)
  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks.map(record).filter((task): task is Record<string, unknown> => Boolean(task)) : []
  const parts: string[] = []
  if (run && typeof run.status === 'string') parts.push(run.status)
  if (tasks.length) {
    const by = (statuses: string[]) => tasks.filter((task) => statuses.includes(String(task.status))).length
    parts.push(`${tasks.length} task${tasks.length === 1 ? '' : 's'}`)
    for (const [label, statuses] of [['active', ['claimed', 'in_progress', 'planned', 'working']], ['blocked', ['blocked']], ['done', ['completed']], ['failed', ['failed']]] as const) {
      const n = by([...statuses])
      if (n) parts.push(`${n} ${label}`)
    }
  }
  return parts
}

function coordinatorMessageLine(message: Record<string, unknown>, max: number): string {
  const from = [message.fromName, message.from, message.fromAgentId].find((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 32) ?? ''
  const flags = [typeof message.kind === 'string' ? message.kind : '', message.priority === 'urgent' ? 'urgent' : '', message.replyRequired === true ? 'reply required' : ''].filter(Boolean)
  const body = typeof message.body === 'string' ? message.body : typeof message.message === 'string' ? message.message : ''
  return `${[from, ...flags].filter(Boolean).join(' · ')}${body ? `  ${truncateLine(compactOneLine(body), max)}` : ''}`
}

// A result too long for its transport arrives cut off, and cut-off JSON does
// not parse. The run's status is near the front of every shape, so say that
// much instead of printing the first hundred characters of the envelope.
function coordinatorTruncatedDigest(raw: string): string | null {
  if (!/^\s*[[{]/.test(raw)) return null
  const status = /"runStatus"\s*:\s*"([a-z_]+)"/.exec(raw)?.[1] ?? /"run"\s*:\s*\{[\s\S]{0,4000}?"status"\s*:\s*"([a-z_]+)"/.exec(raw)?.[1]
  return [status ?? '', 'result cut short'].filter(Boolean).join(' · ')
}

/** The one line a folded call shows under its header: what came back, and what it obliges. */
function coordinatorResultDigest(toolName: string, raw: string): string {
  const payload = record(parseJsonValue(raw))
  if (!payload) return coordinatorTruncatedDigest(raw) ?? ''
  const snapshot = record(payload.snapshot)
  const actionable = record(payload.actionable)
  const owed = coordinatorObligations(actionable)
  const task = record(payload.task)
  const taskId = task && typeof task.id === 'string' ? task.id : ''
  const join = (parts: Array<string | false | null | undefined>, said = '') =>
    `${parts.filter(Boolean).join(' · ')}${said ? `  ${truncateLine(compactOneLine(said), 110)}` : ''}`
  if (payload.accepted === false) return join(['not accepted'], typeof payload.reason === 'string' ? payload.reason : '')
  switch (toolName) {
    case 'coord_status':
      return join([...coordinatorTaskCounts(payload, snapshot), ...owed])
    case 'coord_wait': {
      const events = Array.isArray(payload.events) ? payload.events.map(record).filter(Boolean) : []
      const last = events.at(-1)
      const lead = payload.timedOut === true && payload.changed !== true ? 'no change' : `${events.length} event${events.length === 1 ? '' : 's'}`
      return join([lead, ...owed], last && typeof last.summary === 'string' ? last.summary : '')
    }
    case 'coord_read_inbox': {
      const messages = (Array.isArray(payload.messages) ? payload.messages : []).map(record).filter((entry): entry is Record<string, unknown> => Boolean(entry))
      if (messages.length === 0) return 'inbox empty'
      if (messages.length === 1) return coordinatorMessageLine(messages[0]!, 110)
      const replies = messages.filter((message) => message.replyRequired === true).length
      return join([`${messages.length} messages`, replies ? `${replies} reply required` : ''], coordinatorMessageLine(messages.at(-1)!, 90))
    }
    case 'coord_send_message': {
      const quiet = (Array.isArray(payload.delivery) ? payload.delivery : []).map(record)
        .filter((hint): hint is Record<string, unknown> => Boolean(hint) && hint!.status !== 'fresh')
        .map((hint) => `${String(hint.name)} ${String(hint.status)}`)
      return join(['sent', ...quiet, ...owed.filter((entry) => /owed|urgent/.test(entry))])
    }
    case 'coord_create_task':
    case 'coord_delegate': {
      const delegation = record(payload.delegation)
      const settled = record(payload.settled)
      const similar = Array.isArray(payload.similarTasks) ? payload.similarTasks.map(record).find(Boolean) : null
      return join([
        taskId ? `${taskId} created` : 'created',
        delegation ? `→ ${String(delegation.name)} queued` : '',
        settled ? String(settled.outcome).replace(/_/g, ' ') : '',
        similar ? `similar to ${String(similar.taskId)}` : '',
      ], settled && typeof settled.summary === 'string' ? settled.summary : '')
    }
    case 'coord_claim_task':
      return join([taskId ? `claimed ${taskId}` : 'claimed'], task && typeof task.title === 'string' ? task.title : '')
    case 'coord_request_locks': {
      const granted = Array.isArray(payload.granted) ? payload.granted.length : 0
      const denied = (Array.isArray(payload.denied) ? payload.denied : []).map(record).filter(Boolean)
      const first = denied[0]
      return join([granted ? `${granted} granted` : '', denied.length ? `${denied.length} denied` : ''], first ? `${String(first.path)} — ${String(first.reason)}` : '')
    }
    case 'coord_query_context': {
      const results = (Array.isArray(payload.results) ? payload.results : []).map(record).filter(Boolean)
      const first = results[0]
      return join([results.length ? `${results.length} match${results.length === 1 ? '' : 'es'}` : 'no matches'], first && typeof first.summary === 'string' ? first.summary : '')
    }
    default: {
      const counts = coordinatorTaskCounts(payload, snapshot)
      const status = task && typeof task.status === 'string' ? `${taskId} ${task.status.replace(/_/g, ' ')}` : ''
      return join([payload.accepted === true ? 'accepted' : '', status, ...counts, ...owed.filter((entry) => /owed|urgent|review|finished/.test(entry))])
    }
  }
}

function coordinatorPayloadLines(raw: string, expanded: boolean): TuiTranscriptCardLine[] {
  const parsed = parseJsonValue(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const text = coordinatorTruncatedDigest(raw) ?? raw.split('\n').find((entry) => entry.trim())?.trim() ?? ''
    return text ? [line(truncateLine(text, expanded ? MAX_PREVIEW_CHARS : 120), 'muted')] : []
  }

  const payload = parsed as Record<string, unknown>
  const lines: TuiTranscriptCardLine[] = []
  const participant = payload.participant && typeof payload.participant === 'object'
    ? payload.participant as Record<string, unknown>
    : null
  const task = payload.task && typeof payload.task === 'object'
    ? payload.task as Record<string, unknown>
    : null
  const snapshot = payload.snapshot && typeof payload.snapshot === 'object'
    ? payload.snapshot as Record<string, unknown>
    : payload
  const run = snapshot.run && typeof snapshot.run === 'object'
    ? snapshot.run as Record<string, unknown>
    : null
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : []
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : []

  const digest = coordinatorRunDigest(payload)
  if (payload.accepted === true || digest) {
    lines.push(line([payload.accepted === true ? 'accepted' : '', digest].filter(Boolean).join(' · '), payload.accepted === true ? 'result_ok' : 'agent'))
  }
  if (participant) {
    const name = typeof participant.name === 'string' ? participant.name : participant.agentId
    const role = typeof participant.role === 'string' ? ` · ${participant.role}` : ''
    if (name) lines.push(line(`participant ${String(name)}${role}`, 'agent'))
  }
  if (task) {
    const id = typeof task.id === 'string' ? task.id : typeof task.taskId === 'string' ? task.taskId : 'task'
    const title = typeof task.title === 'string' ? ` · ${task.title}` : ''
    const status = typeof task.status === 'string' ? ` · ${task.status}` : ''
    lines.push(line(`${id}${title}${status}`, 'agent'))
  }
  if (run || tasks.length > 0 || agents.length > 0) {
    const status = run && typeof run.status === 'string' ? run.status : 'run'
    lines.push(line(`${status} · ${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${agents.length} agent${agents.length === 1 ? '' : 's'}`, 'agent'))
  }
  if (messages.length > 0) {
    lines.push(line(`${messages.length} inbox message${messages.length === 1 ? '' : 's'}`, 'agent'))
    if (expanded) {
      for (const message of messages.slice(0, MAX_BLOCK_LINES)) {
        if (!message || typeof message !== 'object' || Array.isArray(message)) continue
        const entry = message as Record<string, unknown>
        lines.push(line(`  ◂ ${coordinatorMessageLine(entry, 140)}`, entry.replyRequired === true || entry.priority === 'urgent' ? 'system' : 'muted'))
      }
    }
  } else if (Array.isArray(payload.messages)) {
    lines.push(line('inbox empty', 'dim'))
  }
  if (expanded) {
    const actionable = record(payload.actionable)
    const owed = coordinatorObligations(actionable)
    // 'system' marks the whole call as needing attention, so it is kept for
    // what does: a reply owed or urgent mail, not a task merely being held.
    if (owed.length) lines.push(line(owed.join(' · '), owed.some((entry) => /owed|urgent/.test(entry)) ? 'system' : 'agent'))
    for (const warning of Array.isArray(actionable?.overlapWarnings) ? actionable.overlapWarnings.slice(0, 4) : []) {
      if (typeof warning === 'string') lines.push(line(`  ⚠ ${truncateLine(warning, 150)}`, 'muted'))
    }
    if (typeof actionable?.replyGuardReminder === 'string') lines.push(line(`  ${truncateLine(compactOneLine(actionable.replyGuardReminder), 150)}`, 'system'))
    const names = new Map(agents.map(record).filter((agent): agent is Record<string, unknown> => Boolean(agent)).map((agent) => [String(agent.id), String(agent.name ?? agent.id)]))
    const open = tasks.map(record).filter((entry): entry is Record<string, unknown> => Boolean(entry) && !['completed', 'cancelled'].includes(String(entry!.status)))
    for (const entry of open.slice(0, 12)) {
      const owner = typeof entry.ownerAgentId === 'string' ? names.get(entry.ownerAgentId) ?? '' : ''
      const status = String(entry.status ?? '').replace(/_/g, ' ')
      lines.push(line(`  ${String(entry.id)} · ${status}${owner ? ` · ${owner}` : ''}  ${truncateLine(compactOneLine(String(entry.title ?? '')), 100)}`,
        'muted'))
    }
    if (open.length > 12) lines.push(line(`  … ${open.length - 12} more open tasks`, 'dim'))
    for (const grant of (Array.isArray(payload.granted) ? payload.granted : []).map(record).slice(0, 8)) {
      if (grant) lines.push(line(`  granted ${String(grant.path)}`, 'result_ok'))
    }
    for (const refusal of (Array.isArray(payload.denied) ? payload.denied : []).map(record).slice(0, 8)) {
      if (refusal) lines.push(line(`  denied ${String(refusal.path)} — ${truncateLine(String(refusal.reason ?? ''), 110)}`, 'result_error'))
    }
    for (const match of (Array.isArray(payload.results) ? payload.results : []).map(record).slice(0, 8)) {
      if (match) lines.push(line(`  ${String(match.kind ?? 'match')}${typeof match.taskId === 'string' ? ` · ${match.taskId}` : ''}  ${truncateLine(compactOneLine(String(match.summary ?? '')), 120)}`, 'muted'))
    }
    for (const event of (Array.isArray(payload.events) ? payload.events : []).map(record).slice(-8)) {
      if (event) lines.push(line(`  ${String(event.type ?? 'event')}  ${truncateLine(compactOneLine(String(event.summary ?? '')), 120)}`, 'muted'))
    }
    if (typeof payload.reason === 'string' && payload.accepted === false) lines.push(line(`  ${truncateLine(compactOneLine(payload.reason), 200)}`, 'result_error'))
  }
  if (lines.length === 0) {
    const keys = Object.keys(payload).filter((key) => !key.startsWith('_')).slice(0, 4)
    if (keys.length > 0) lines.push(line(keys.join(' · '), 'dim'))
  }
  return lines
}

export function formatCoordinatorTool(thread: ToolThread, expanded: boolean): TuiTranscriptCardLine[] | null {
  const call = coordinatorCall(thread)
  if (!call) return null
  const { toolName, input } = call
  const inputSummary = coordinatorInputSummary(input)
  const header = coordinatorHeader(toolName, input)
  const lines: TuiTranscriptCardLine[] = [
    line(header
      ? `coordinator ${header}`
      : `coordinator ${coordinatorActionLabel(toolName)}${inputSummary ? ` · ${inputSummary}` : ''}`, 'tool'),
  ]
  if (!thread.result) return [...lines, line('… pending', 'dim')]

  const transportFailed = input.status === 'failed'
  const resultText = coordinatorResultText(thread, call.shell)
  // A completion the gate refused is an answer, not a transport error, but it
  // is the failure the reader is looking for.
  const refused = /^\s*\{[\s\S]{0,200}"accepted"\s*:\s*false/.test(resultText)
  const isError = thread.result.is_error === true || transportFailed || refused
  const payloadLines = coordinatorPayloadLines(resultText, expanded)
  // Each call says what it returned and what that obliges. Every mutation also
  // carries the run's digest, which after a message is not news — three sends
  // in a row said "running · 3 tasks · 3 active" three times.
  const digest = (isError && !refused ? '' : coordinatorResultDigest(toolName, resultText)) || payloadLines[0]?.text
  if (!expanded) {
    return [
      ...lines,
      line(`${isError ? '✗' : '✓'} ${digest || (isError ? 'failed' : 'complete')}`, isError ? 'result_error' : 'result_ok'),
    ]
  }
  lines.push(line(`${isError ? '✗' : '✓'} ${digest || (isError ? 'failed' : 'complete')}`, isError ? 'result_error' : 'result_ok'))
  if (isError && payloadLines.length > 0) payloadLines[0] = { ...payloadLines[0], tone: 'result_error' }
  lines.push(...payloadLines)
  return lines
}

function coordinatorRunLabel(runId: string | null): string {
  if (!runId) return ''
  return ` · run ${runId.length > 18 ? `${runId.slice(0, 17)}…` : runId}`
}

// The standing brief is the same screen of instructions on every delivered
// turn. It is named, not printed: the reader wants to know a coordinated turn
// began and as whom, and the text is one RAW away.
export function coordinatorBriefLines(block: CoordinatorBriefBlock): TuiTranscriptCardLine[] {
  const who = block.role === 'lead' ? 'lead' : `${block.agentName ?? 'agent'} (${block.role})`
  return [line(`⇄ Coordinator · ${who}${coordinatorRunLabel(block.runId)} · standing instructions folded`, 'dim')]
}

// Mail reads as who said what. The uuid and the `kind=… priority=…` header it
// arrives under are routing detail; what survives is the sender, the kind, and
// the two flags that oblige the reader to do something.
export function coordinatorMailLines(block: CoordinatorMailBlock, expanded: boolean): TuiTranscriptCardLine[] {
  const senders = [...new Set(block.messages.map((message) => message.from))]
  const count = block.messages.length
  // One message is its own heading: "1 team message · nova" above "◂ nova ·
  // request" said the sender twice.
  const lines: TuiTranscriptCardLine[] = count === 1 ? [] : [
    line(count === 0
      ? '⇄ Coordinator · no new mail'
      : `⇄ ${count} team messages · ${senders.join(', ')}`, 'dim'),
  ]
  for (const note of block.notes) lines.push(line(`  ${truncateLine(note, 160)}`, 'dim'))
  // A teammate that answers and then hands its task off sends the answer
  // twice: once as the reply, once inside the handoff's summary. The second
  // copy is pointed at rather than printed again.
  const said = new Map<string, string[]>()
  for (const message of block.messages) {
    const flags = [message.urgent ? 'urgent' : '', message.replyRequired ? 'reply required' : ''].filter(Boolean).join(' · ')
    const head = `◂ ${message.from} · ${message.kind}${flags ? ` · ${flags}` : ''}`
    const tone: TuiTranscriptLineTone = message.urgent || message.replyRequired ? 'system' : 'agent'
    const earlier = (said.get(message.from) ?? []).find((body) => body.length >= 40 && message.body.includes(body))
    const body = earlier ? message.body.replace(earlier, '[as in the message above]') : message.body
    said.set(message.from, [...(said.get(message.from) ?? []), message.body.trim()])
    const bodyLines = sanitizeLine(body).split('\n').map((entry) => entry.trimEnd()).filter((entry, index, all) => entry || (index > 0 && all[index - 1]))
    // A status note is one line of news; it rides the sender's own row.
    // Anything else keeps its words off that row: the row's colour says who
    // and how urgently, and a paragraph in that colour says it about every word.
    if (message.kind === 'status' || bodyLines.length === 0) {
      const oneLine = bodyLines.join(' ').trim()
      lines.push(line(oneLine ? `${head}  ${expanded ? oneLine : truncateLine(oneLine, 140)}` : head, message.kind === 'status' ? 'muted' : tone))
      continue
    }
    lines.push(line(head, tone))
    const shown = expanded ? bodyLines : bodyLines.slice(0, 3)
    for (const entry of shown) lines.push(line(`  ${expanded ? entry : truncateLine(entry, 160)}`, 'default'))
    if (shown.length < bodyLines.length) lines.push(line(`  … ${bodyLines.length - shown.length} more lines`, 'dim'))
  }
  return lines
}
