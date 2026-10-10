/** @jsxImportSource @opentui/react */
// Interactive Coordinator for the conversation the reader is on — the TUI's
// counterpart to the web's CoordinatorConversation panel.
//
// Promoting a chat to lead of a Coordinator run is a property of that chat, not
// of a run, so this is session-scoped where CoordinationPopover is run-scoped:
// the two answer "who is helping me here" and "what is every run doing".
//
// It takes only layout props and reads everything else from
// `interactiveCoordinatorStore`, which is what lets the `memo` hold — a
// coordinator refresh repaints these rows and nothing else.
import { TextAttributes } from '@opentui/core'
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { CoordinatorRecovery } from './CoordinatorRecovery'
import { CoordinatorResources } from './CoordinatorResources'
import { CoordinatorWorkflow } from './CoordinatorWorkflow'
import { CoordinatorResultReview } from './CoordinatorResultReview'
import type { TuiThemePalette } from '../theme'
import { getProviderAccent } from '../theme'
import { formatProviderLabel } from '../format'
import type { AgentProvider } from '../../lib/types'
import { COORDINATOR_ROSTER_FILTERS, COORDINATOR_ROSTER_LABELS, filterCoordinatorRoster, type CoordinatorRosterFilter } from '../../lib/coordinatorRosterFilter'

/** Providers a chat can staff a NEW teammate from; cycled with `p`. */
const COORDINATOR_TEAMMATE_PROVIDERS: readonly AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi']

/**
 * Herdr refuses to close a workspace with linked worktree workspaces without
 * explicit group intent, and never removes a dirty checkout quietly. Ending a
 * team leaves its teammate checkouts on disk with nothing pointing at them, so
 * the confirmation names them instead of asking a bare yes/no.
 */
/**
 * `@reviewer check the diff` names the teammate the work goes to — herdr's
 * `agent start reviewer`: the live teammate of that name if there is one, a
 * new one under that name if not. Without the prefix, any available teammate.
 * The server validates the name, so this only splits it off.
 */
export { delegateTarget as __delegateTargetForSmoke }
function delegateTarget(text: string, to: string | null): { detail: string; to: string; teammateName?: string } {
  const named = to ? null : /^@([a-z][a-z0-9_-]{0,31})\s+([\s\S]+)$/i.exec(text)
  return named ? { detail: named[2]!.trim(), to: 'auto', teammateName: named[1]!.toLowerCase() } : { detail: text, to: to ?? 'auto' }
}

/**
 * Fit `a  ·  b  ·  c` by dropping whole entries from the end — the entries are
 * ordered most important first — rather than cutting a word in half, which is
 * how "alerts in-app" became "alerts in-ap…" on a 60-column terminal. Only a
 * first entry that cannot fit on its own is truncated.
 */
function fitDraftRow(label: string, text: string, width: number): { label: string; text: string } {
  const minimumText = Math.min(text.length, Math.max(12, Math.floor(width / 2)))
  const labelRoom = width - minimumText
  // A parenthetical hint is the first thing to go, then the label is cut, then
  // it is dropped — never the text being typed.
  const withoutHint = label.replace(/\s*\([^)]*\)/, '')
  const fittedLabel = label.length <= labelRoom ? label
    : withoutHint.length <= labelRoom ? withoutHint
    : labelRoom >= 8 ? `${fitText(withoutHint.trimEnd().replace(/:$/, ''), labelRoom - 2).trimEnd()}: `
    : ''
  const textRoom = width - fittedLabel.length
  return { label: fittedLabel, text: text.length <= textRoom ? text : `…${text.slice(text.length - textRoom + 1)}` }
}

function fitMetaEntries(meta: string, width: number): string {
  const entries = meta.split('  ·  ')
  let fitted = entries[0] ?? ''
  for (const entry of entries.slice(1)) {
    const next = `${fitted}  ·  ${entry}`
    if (next.length > width) break
    fitted = next
  }
  return fitted.length > width ? fitText(fitted, width).trimEnd() : fitted
}

function teardownWarning(teardown: InteractiveCoordinatorTeardown | null): string | null {
  if (!teardown) return null
  const parts: string[] = []
  if (teardown.runningTurns.length > 0) parts.push(`${teardown.runningTurns.join(', ')} still working`)
  for (const entry of teardown.worktrees) {
    parts.push(entry.changedFiles < 0
      ? `${entry.agentName}: ${entry.branch || entry.path} could not be read`
      : `${entry.agentName}: ${entry.changedFiles} uncommitted in ${entry.branch || entry.path}`)
  }
  if (parts.length === 0) return null
  return `Turn off coordination? ${parts.join(' · ')} — branches stay on disk.`
}
import { fitText, joinMeta } from './textLayout'
import { MODAL_CONTENT_Z_INDEX } from './layers'
import type { ProtocolAgent } from '../../lib/agentProtocol'
import { describeRunRollup } from '../../lib/coordinatorRollup'
import { coordinatorAttention, type CoordinatorAttentionItem } from '../../lib/coordinatorAttention'
import { coordinatorPickerState, coordinatorResultIdsForAgent } from '../../lib/coordinatorSignals'
import { coordinatorAgentActivity, coordinatorAgentNote, coordinatorAgentWorkspace, coordinatorStalledAgentIds } from '../../lib/coordinatorInteractiveState'
import {
  closeInteractiveCoordinator,
  readInteractiveCoordinatorTeardown,
  type InteractiveCoordinatorTeardown,
  discardInteractiveCoordinatorAction,
  getInteractiveCoordinatorState,
  retryInteractiveCoordinatorAction,
  reviewInteractiveCoordinatorResult,
  reviewInteractiveCoordinatorResults,
  runInteractiveCoordinatorAction,
  cycleInteractiveCoordinatorNotifications,
  subscribeInteractiveCoordinator,
} from './interactiveCoordinatorStore'

type TeammatesKeyEvent = { name: string; ctrl: boolean; shift: boolean; sequence: string }

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  onOpenSession: (agent: ProtocolAgent) => void
  /** Show these teammates' transcripts in split panes beside the reader, in order of priority. */
  onWatchSessions: (agents: ProtocolAgent[]) => void
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  onKeyHandlerReady: (handler: (key: TeammatesKeyEvent) => void) => void
}

/** Composing a task or a message; `to` is null for "any available teammate". */
type Draft = { kind: 'delegate' | 'message' | 'decision'; to: string | null; toName: string; text: string; taskId?: string; decisionId?: string; inReplyTo?: string }

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'stopped'])
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled'])
// The least of a waiting result the attention card quotes before pointing at
// the review that shows all of it; a tall terminal shows a third of its rows.
const ATTENTION_DETAIL_LINES = 6
// At this inner width a teammate is one row — name, status and its last word.
// Below it the three stack, because a status cut to fit says nothing. Shared
// with the height estimate.
const ROSTER_NOTE_MIN_WIDTH = 70

// The board owns every keystroke while it is open (App.tsx forwards raw keys
// here rather than letting a focused OpenTUI <input> see them), so the draft
// field is built from key events like CoordinationPopover's message composer.
function isPrintable(key: TeammatesKeyEvent): boolean {
  return !key.ctrl && Array.from(key.sequence).length === 1 && key.sequence >= ' '
}

export const TeammatesPopover = memo(function TeammatesPopover({
  theme, width, height, onOpenSession, onWatchSessions, onNotice, onKeyHandlerReady,
}: Props) {
  const state = useSyncExternalStore(
    subscribeInteractiveCoordinator, getInteractiveCoordinatorState, getInteractiveCoordinatorState,
  )
  // Selection is by teammate id: the roster reorders by attention, and a
  // positional index would silently retarget `m` or `r` to whoever moved there.
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [resultTaskId, setResultTaskId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rosterQuery, setRosterQuery] = useState('')
  const [rosterFilter, setRosterFilter] = useState<CoordinatorRosterFilter>('all')
  const [searching, setSearching] = useState(false)
  const [attentionIndex, setAttentionIndex] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)
  // What turning off would leave behind: teammate checkouts with uncommitted
  // work, and turns still running. Read when the confirm opens, never polled.
  const [teardown, setTeardown] = useState<InteractiveCoordinatorTeardown | null>(null)
  // Provider for the NEXT new teammate; an existing one keeps its own. `null`
  // means the lead conversation's provider.
  // Cancelling a task fails what depends on it, so it takes a second press (X, then y).
  const [confirmCancel, setConfirmCancel] = useState<{ taskId: string; title: string; agentName: string } | null>(null)
  const [newTeammateProvider, setNewTeammateProvider] = useState<AgentProvider | null>(null)

  const { data, session, busy, pending, error } = state
  const snapshot = data?.snapshot ?? null
  const enabled = data?.interactive.enabled ?? false
  const terminal = snapshot ? TERMINAL_RUN_STATUSES.has(snapshot.run.status) : false
  // Only the lead conversation may drive the run; a teammate's own transcript
  // opened in the reader must not offer to turn the room off.
  const canLead = !snapshot
    || snapshot.agents.some((agent) => agent.role === 'lead' && agent.sessionId === session?.sessionId)

  const roster = useMemo(() => filterCoordinatorRoster(data, state.reviewed, rosterQuery, rosterFilter, state.observationUnavailable), [data, state.reviewed, rosterQuery, rosterFilter, state.observationUnavailable])
  const teammates = roster.agents
  // A refresh may move the selected agent out of a state filter. Require
  // another deliberate navigation action rather than silently retargeting it.
  // The lead heads the roster: it is a member of the team, it can hold tasks,
  // and a board that lists everyone but the lead reads as if the work happens
  // somewhere else. It can be moved onto and opened; it is never `selected`,
  // because every roster action (ask, message, resume, interrupt) is something
  // the lead does to a teammate.
  const leadAgent = teammates.length > 0 ? snapshot?.agents.find(agent => agent.id === snapshot.run.leadAgentId) ?? null : null
  const rosterLead = leadAgent && !teammates.some(agent => agent.id === leadAgent.id) ? leadAgent : null
  const leadSelected = Boolean(rosterLead) && selectedId === rosterLead!.id
  const found = selectedId === null ? 0 : teammates.findIndex((agent) => agent.id === selectedId)
  // A selection that left the roster (filtered out, or a teammate that went
  // away) falls back to the first row rather than to nobody.
  const clamped = leadSelected ? -1 : Math.max(found, 0)
  const selected = leadSelected ? null : teammates[clamped] ?? null
  // Whichever agent's conversation the panel was opened from. Opened from a
  // teammate's transcript, that is the teammate — not the lead.
  const viewingAgentId = session ? snapshot?.agents.find(agent => agent.sessionId === session.sessionId)?.id ?? null : null
  const delivery = data?.interactive.delivery ?? null
  const unconfirmedDelivery = delivery && !delivery.active ? delivery : null
  const recoveries = data?.recoveries ?? []
  // Recomputed per read: the feed re-reads every few seconds, which is as fine
  // as a 15s stall window needs (the label lands within one read of crossing it).
  const stalled = useMemo(() => coordinatorStalledAgentIds(data), [data])
  const attention = useMemo(
    () => (data?.permissions ?? []).filter((item) => item.agentId !== snapshot?.run.leadAgentId),
    [data, snapshot],
  )
  // An unresolved request is a hard gate, not a warning: a second mutation
  // while the first's outcome is unknown is what the idempotency key cannot
  // protect against.
  const runInfo = useMemo(
    () => snapshot?.rollup && snapshot.rollup.tasks.total > 0 ? describeRunRollup(snapshot.rollup, snapshot.run.budget) : null,
    [snapshot],
  )
  const items = useMemo(() => snapshot ? coordinatorAttention(snapshot).filter(item => item.kind !== 'result' || !state.reviewed.includes(item.id)) : [], [snapshot, state.reviewed])
  const currentAttention = items[Math.min(attentionIndex, Math.max(items.length - 1, 0))] ?? null
  const elsewhere = data?.interactive.executionElsewhere === true
  const locked = busy || Boolean(pending) || elsewhere
  const disabled = locked || terminal || !canLead

  const act = useCallback((
    request: Parameters<typeof runInteractiveCoordinatorAction>[0],
    success: string,
  ) => {
    void runInteractiveCoordinatorAction(request).then((ok) => {
      if (ok) onNotice('info', success, 4000)
    })
  }, [onNotice])

  const handleKey = useCallback((key: TeammatesKeyEvent) => {
    if (searching) {
      if (key.name === 'escape' || key.name === 'return') { setSearching(false); return }
      if (key.ctrl && key.name === 'u') { setRosterQuery(''); setSelectedId(null); return }
      if (key.name === 'backspace') { setRosterQuery(current => Array.from(current).slice(0, -1).join('')); setSelectedId(null); return }
      if (key.name === 'paste' || (!key.ctrl && key.sequence && !/[\x00-\x1f\x7f]/.test(key.sequence))) { setRosterQuery(current => (current + key.sequence.replace(/[\r\n]/g, ' ')).slice(0, 200)); setSelectedId(null) }
      return
    }
    if (!draft && !confirmCancel && !confirmOff) {
      if (key.name === '/') { setSearching(true); return }
      if (key.name === 't') { setRosterFilter(current => COORDINATOR_ROSTER_FILTERS[(COORDINATOR_ROSTER_FILTERS.indexOf(current) + 1) % COORDINATOR_ROSTER_FILTERS.length]!); setSelectedId(null); return }
      if (key.ctrl && key.name === 'u') { setRosterQuery(''); setRosterFilter('all'); setSelectedId(null); return }
    }
    if (key.name === 'h' && !draft && !confirmCancel && !confirmOff && session) { setRecoveryOpen(true); return }
    if (key.name === 'g' && !disabled && !draft && !confirmCancel && !confirmOff && data?.interactive.resources) { setResourcesOpen(true); return }
    if (key.name === 'f' && !disabled && !draft && !confirmCancel && !confirmOff) { setWorkflowOpen(true); return }
    if (draft) {
      if (key.name === 'paste') { setDraft({ ...draft, text: (draft.text + key.sequence.replace(/\r\n?/g, '\n')).slice(0, 8000) }); return }
      if (key.name === 'escape') { setDraft(null); return }
      if (key.name === 'return') {
        const text = draft.text.trim()
        if (!text) { setDraft(null); return }
        act(draft.kind === 'delegate'
          ? { action: 'delegate', ...delegateTarget(text, draft.to), teammateProvider: draft.to ? undefined : newTeammateProvider ?? undefined }
          : { action: draft.kind, detail: text, to: draft.to ?? undefined, taskId: draft.taskId, decisionId: draft.decisionId, inReplyTo: draft.inReplyTo },
          draft.kind === 'delegate' ? `Task sent to ${draft.toName}` : `Message sent to ${draft.toName}`)
        setDraft(null)
        return
      }
      if (key.name === 'backspace') { setDraft({ ...draft, text: Array.from(draft.text).slice(0, -1).join('') }); return }
      if (isPrintable(key)) setDraft({ ...draft, text: (draft.text + key.sequence).slice(0, 8000) })
      return
    }
    if (confirmCancel) {
      const cancelling = confirmCancel
      setConfirmCancel(null)
      if (key.name === 'return' || key.name === 'y') {
        act({ action: 'cancel-task', taskId: cancelling.taskId, detail: `Cancel ${cancelling.taskId} for ${cancelling.agentName}` }, `${cancelling.taskId} cancelled`)
      }
      return
    }
    if (confirmOff) {
      if (key.name === 'return' || key.name === 'y') {
        setConfirmOff(false)
        act({ action: 'disable', detail: 'Turn off coordination for this conversation' }, 'Coordination turned off')
        return
      }
      setConfirmOff(false)
      return
    }
    if (key.name === 'escape' || key.name === 'q') { closeInteractiveCoordinator(); return }

    // Uncertain delivery requires transcript inspection before retry/discard.
    // Keep reading and roster navigation available while mutations are gated.
    if (key.name === 'return' && leadSelected && rosterLead) {
      if (rosterLead.id === viewingAgentId) { onNotice('info', 'The lead is the conversation you are in', 3000); return }
      onOpenSession(rosterLead); closeInteractiveCoordinator(); return
    }
    if (key.name === 'return' && selected) {
      reviewInteractiveCoordinatorResults(coordinatorResultIdsForAgent(snapshot, selected.id))
      onOpenSession(selected); closeInteractiveCoordinator(); return
    }
    // Herdr keeps every agent on screen at once; `o` puts the selected
    // teammate beside the lead's chat, `O` the team in attention order. Only
    // reads, so it stays available while a request is unconfirmed. Watching
    // is not reviewing: results stay flagged until a transcript is opened.
    // Terminals disagree on how Shift+O arrives (name `O`, or `o` with shift).
    const watchTeam = key.sequence === 'O' || (key.name.toLowerCase() === 'o' && key.shift)
    if ((watchTeam && teammates.length) || (key.name === 'o' && !watchTeam && selected)) {
      onWatchSessions(watchTeam ? teammates : [selected!]); closeInteractiveCoordinator(); return
    }
    // Alert delivery is a local preference, not a Coordinator mutation, so it
    // stays available while a request is unconfirmed.
    if (key.name === 'l') {
      const mode = cycleInteractiveCoordinatorNotifications()
      onNotice('info', mode === 'off' ? 'Teammate alerts off' : mode === 'in-app' ? 'Teammate alerts: in-app only' : 'Teammate alerts: in-app and desktop', 3000)
      return
    }
    if (key.name === 'j' || key.name === 'down') {
      setSelectedId(teammates[Math.min(clamped + 1, Math.max(teammates.length - 1, 0))]?.id ?? null)
      return
    }
    if (key.name === 'k' || key.name === 'up') {
      // Up from the first teammate is the lead's row.
      setSelectedId(clamped <= 0 && rosterLead ? rosterLead.id : teammates[Math.max(clamped - 1, 0)]?.id ?? null)
      return
    }

    // An unconfirmed request owns the panel until it is resolved.
    if (pending) {
      if (key.name === 'r') { void retryInteractiveCoordinatorAction(); return }
      if (key.name === 'e') { discardInteractiveCoordinatorAction(); return }
      return
    }
    if (key.name === '[' || key.name === ']') {
      setAttentionIndex(current => items.length ? (current + (key.name === ']' ? 1 : -1) + items.length) % items.length : 0)
      return
    }
    if (key.name === 'v' && (!currentAttention || currentAttention.kind !== 'plan')) {
      const taskId = currentAttention?.kind === 'result' ? currentAttention.taskId : snapshot?.tasks.filter(task => task.ownerAgentId === selected?.id && ['completed', 'failed', 'cancelled'].includes(task.status)).at(-1)?.id
      if (taskId) setResultTaskId(taskId)
      return
    }
    if (currentAttention?.kind === 'result' && key.name === 's') { reviewInteractiveCoordinatorResult(currentAttention.id); return }
    if (currentAttention && !disabled) {
      if (currentAttention.kind === 'plan' && (key.name === 'a' || key.name === 'v')) {
        const approved = key.name === 'a'
        act({ action: 'review-plan', taskId: currentAttention.taskId, approved, detail: approved ? 'Plan approved by user' : 'Plan rejected; revise before proceeding' }, approved ? 'Plan approved' : 'Plan revision requested')
        return
      }
      if (key.name === 'b' && ['decision', 'message', 'blocker'].includes(currentAttention.kind)) {
        setDraft({ kind: currentAttention.kind === 'decision' ? 'decision' : 'message', to: currentAttention.agentId ?? null,
          toName: currentAttention.title, text: '', taskId: currentAttention.taskId, decisionId: currentAttention.decisionId, inReplyTo: currentAttention.messageId })
        return
      }
    }
    if ((!enabled || terminal) && key.name === 'e' && !locked && canLead) {
      act({ action: 'enable', detail: 'Enable interactive coordination' }, 'Coordinator enabled for this conversation')
      return
    }
    if (!enabled && teammates.length === 0) {
      if (key.name === 'e' && !busy && !terminal && canLead) {
        act({ action: 'enable', detail: 'Enable interactive coordination' }, 'Coordinator enabled for this conversation')
      }
      return
    }
    if (key.name === 'e' && !enabled && !disabled) {
      act({ action: 'enable', detail: 'Enable interactive coordination' }, 'Coordinator enabled for this conversation')
      return
    }
    if (key.name === 'c' && enabled && !disabled) {
      act({ action: 'settings', detail: 'Update automatic continuation', autoContinue: !data?.interactive.autoContinue },
        data?.interactive.autoContinue ? 'Automatic continuation off' : 'Automatic continuation on')
      return
    }
    if (key.name === 'w' && enabled && !disabled) {
      const useWorktrees = snapshot?.run.useWorktrees === false
      act({ action: 'settings', detail: 'Update teammate worktrees', useWorktrees },
        useWorktrees ? 'New teammates get their own worktree' : 'New teammates share this checkout')
      return
    }
    if (unconfirmedDelivery && (key.name === 'y' || key.name === 'n') && !locked) {
      const received = key.name === 'y'
      act({ action: 'reconcile', detail: received ? 'Confirmed delivery in transcript' : 'Confirmed mail was not received',
        batchId: unconfirmedDelivery.batchId, received },
        received ? 'Delivery confirmed' : 'Mail requeued for the next message')
      return
    }
    // Take the selected teammate's task away (⇧X): `i` only stops the turn, and
    // the teammate starts again. Asks first — it releases locks and fails dependents.
    if ((key.sequence === 'X' || (key.name.toLowerCase() === 'x' && key.shift)) && selected && !disabled) {
      const task = snapshot?.tasks.find(entry => entry.id === selected.taskId)
      if (!task || ['completed', 'failed', 'cancelled'].includes(task.status)) {
        onNotice('info', `${selected.name} has no open task to cancel`, 3000)
        return
      }
      setConfirmCancel({ taskId: task.id, title: task.title, agentName: selected.name })
      return
    }
    if (key.name === 'x' && !disabled) {
      setConfirmOff(true)
      setTeardown(null)
      void readInteractiveCoordinatorTeardown().then(setTeardown)
      return
    }
    if (key.name === 'r' && selected && !disabled) {
      if (!recoveries.includes(selected.id)) {
        onNotice('info', `${selected.name} does not need recovery`, 3000)
        return
      }
      act({ action: 'resume-agent', to: selected.id, detail: 'Resume after inspecting the teammate transcript' },
        `${selected.name} resumed`)
      return
    }
    // Stop a teammate that is off down the wrong path without taking its task
    // away — herdr's `agent send-keys <name> ctrl+c`.
    if (key.name === 'i' && selected && !disabled) {
      const running = data?.runningAgentIds.includes(selected.id) || selected.turnActive
      if (!running) {
        onNotice('info', `${selected.name} has no turn running`, 3000)
        return
      }
      act({ action: 'interrupt-agent', to: selected.id, detail: `Interrupt ${selected.name}` }, `${selected.name} interrupted`)
      return
    }
    if (key.name === 'd' && !disabled) {
      setDraft({ kind: 'delegate', to: null, toName: '(@name to choose)', text: '' })
      return
    }
    // Cycle which provider a NEW teammate is staffed from — a Codex reviewer
    // beside a Claude implementer is the point of routing work by provider.
    if (key.name === 'p' && !disabled) {
      const index = newTeammateProvider === null ? 0 : COORDINATOR_TEAMMATE_PROVIDERS.indexOf(newTeammateProvider) + 1
      const next = index >= COORDINATOR_TEAMMATE_PROVIDERS.length ? null : COORDINATOR_TEAMMATE_PROVIDERS[index]!
      setNewTeammateProvider(next)
      onNotice('info', next ? `New teammates use ${formatProviderLabel(next)}` : 'New teammates use this conversation\'s provider', 3000)
      return
    }
    if (key.name === 'm' && selected && !disabled) {
      setDraft({ kind: 'message', to: selected.id, toName: selected.name, text: '' })
    }
  }, [act, busy, canLead, confirmCancel, confirmOff, data, disabled, draft, enabled, locked, onNotice, onOpenSession, onWatchSessions,
      pending, recoveries, selected, teammates, clamped, leadSelected, rosterLead, viewingAgentId, newTeammateProvider, snapshot, terminal, unconfirmedDelivery, currentAttention, items.length, session, searching])

  useEffect(() => { if (!resultTaskId && !workflowOpen && !resourcesOpen && !recoveryOpen) onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady, resultTaskId, workflowOpen, resourcesOpen, recoveryOpen])

  // As wide as the terminal allows, up to a line length that still reads. At
  // 96 a teammate's status and its last word were cut on screens with twice
  // that to give.
  const popW = Math.min(width - 4, 132)
  // Height follows the content. A fixed 32 rows meant a small team — the
  // common case — sat in a panel two thirds empty, with its footer stranded at
  // the bottom of the screen and nothing between. The estimate mirrors the
  // sections below; being a row out costs a blank line or a scrollbar, where
  // being fixed cost twenty.
  const innerWidthEstimate = popW - 4
  // A roster row answers "who is doing what" on its own: the teammate, its
  // task and how that stands. The task it shows is the one it holds now, else
  // the last it owned. With that on the row, the TASKS list below repeats the
  // roster with the columns swapped, so it keeps only tasks no row shows.
  const compactRoster = innerWidthEstimate >= ROSTER_NOTE_MIN_WIDTH
  const rosterAgents = rosterLead ? [rosterLead, ...teammates] : teammates
  const rosterTaskByAgent = new Map<string, NonNullable<typeof snapshot>['tasks'][number]>()
  if (snapshot) {
    for (const agent of rosterAgents) {
      const task = snapshot.tasks.find(entry => entry.id === agent.taskId)
        ?? snapshot.tasks.findLast(entry => entry.ownerAgentId === agent.id)
      if (task) rosterTaskByAgent.set(agent.id, task)
    }
  }
  const shownTaskIds = new Set(compactRoster ? [...rosterTaskByAgent.values()].map(task => task.id) : [])
  const listedTasks = snapshot ? snapshot.tasks.filter(task => !shownTaskIds.has(task.id)) : []
  const rosterNameWidth = Math.min(rosterAgents.reduce((widest, agent) => Math.max(widest, agent.name.length), 4), 18)
  const wrapped = (text: string) => Math.max(1, Math.ceil(text.length / Math.max(1, popW - 4)))
  const settingRows = (label: string) => Math.max(1, Math.ceil(label.length / Math.max(8, popW - 4 - 6)))
  const controlHints = `f workflow${data?.interactive.resources ? ' · g limits' : ''} · h recovery`
  // The word yields to the keys on a panel too narrow for both on one row.
  const settingsHeading = `SETTINGS · ${controlHints}`.length <= popW - 4 ? `SETTINGS · ${controlHints}` : controlHints
  // The attention card names what is waiting; the whole of a long result is
  // one key away, and printing it here pushed the roster off the panel.
  const attentionDetail = (() => {
    const all = (currentAttention?.detail ?? '').split('\n').filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1]!.trim()))
    // A taller terminal can afford more of the result before the fold.
    const shown = all.slice(0, Math.max(ATTENTION_DETAIL_LINES, Math.floor((height - 4) / 3)))
    return { text: shown.join('\n').trimEnd(), hidden: all.length - shown.length }
  })()
  const bodyRows = (state.loading && !data ? 1 : 0)
    + (pending ? wrapped('The last request is unconfirmed. Retrying replays the same request, which the server reconciles instead of repeating.') + (error ? 1 : 0) + 1 : error ? 2 : 0)
    + (!enabled && !terminal ? wrapped('Enable coordination to give this chat a team. Teammates run their own turns; what they send back arrives folded into your next message, and you keep every approval.') + (canLead ? 0 : 2) : 0)
    + (currentAttention ? 3 + attentionDetail.text.split('\n').reduce((rows, line) => rows + wrapped(line), 0) + (attentionDetail.hidden > 0 ? 1 : 0) : 0)
    // The settings labels wrap under their checkbox on a narrow terminal, so
    // count their rows at that width or the roster falls below the fold.
    + (enabled ? 1 + wrapped(settingsHeading) + settingRows(' Continue when teammates respond') + settingRows(' Give new teammates their own worktree')
      + (data?.interactive.autoContinue && data.interactive.remainingTurns === 0 ? 2 : 0) : 0)
    + (unconfirmedDelivery ? 4 : 0)
    + (teammates.length > 0
      // A heading row, then a row a teammate — two where its note has no room
      // beside it. Over-counting a note costs a blank row; under-counting one
      // costs the footer.
      ? 1 + (rosterAgents.length > teammates.length ? 1 : 0)
        + teammates.reduce((rows, agent) => rows + (innerWidthEstimate >= ROSTER_NOTE_MIN_WIDTH ? 1 : 2 + (coordinatorAgentNote(agent, snapshot) ? 1 : 0)), 0)
      : enabled ? 3 : 0)
    + (enabled && runInfo ? 2 + (runInfo.warning ? 1 : 0) + (runInfo.idleWarning ? wrapped(`⚠ ${runInfo.idleWarning}`) : 0) + runInfo.overlapLines.length + (runInfo.hiddenOverlaps ? 1 : 0) + runInfo.holdUpLines.length : 0)
    + attention.length + recoveries.length
    + (listedTasks.length > 0 ? (enabled && runInfo ? 1 : 2) + Math.min(listedTasks.length, 6) : 0)
  // 6 = header 2 + footer 2 + border 2, matching bodyH below.
  // The floor is the scrollbox's own minimum (6) plus header, footer and
  // border: below it the footer draws outside the box.
  // Content decides the height, the terminal bounds it. A fixed ceiling of 32
  // rows scrolled a team's roster on a screen with room to show all of it.
  const popH = Math.max(12, Math.min(height - 4, bodyRows + 6 + (draft || confirmOff || confirmCancel ? 1 : 0)))
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = popW - 4
  // Header 2 + footer 2 + the box's own border 2, plus the draft/confirm row
  // when it is showing — the scrollbox has a fixed height budget, so a row that
  // appears without being subtracted here pushes the footer off the frame.
  const bodyH = Math.max(popH - 6 - (draft || confirmOff || confirmCancel ? 1 : 0), 6)

  const attentionCount = items.length + attention.length + recoveries.length + (data?.settledExecutions?.length ?? 0) + stalled.length + (unconfirmedDelivery ? 1 : 0) + (enabled && !terminal ? runInfo?.attentionCount ?? 0 : 0)
  // Status and its meta are separate <text>s so only the status carries colour;
  // colouring the whole joined line made every word shout at the same volume.
  const headline = !session ? 'No conversation selected'
    : elsewhere ? 'Running in another host'
    : terminal ? 'Run ended'
    : !enabled ? 'Coordination is off'
    : 'Coordinator on'
  const headlineMeta = elsewhere ? 'Use the owning window or connect to its server'
    : !session || !enabled ? ''
    : terminal ? 'results and teammate transcripts remain'
    // Ordered by what the reader must not lose when this is truncated on a
    // narrow terminal (herdr is used over SSH from a phone): what is waiting,
    // then a silenced alert mode — which nothing else on screen admits to —
    // and the head count last, since the roster shows it anyway.
    // "nothing waiting" is the least informative thing here, so it yields
    // before a silenced alert mode does.
    : joinMeta([
        attentionCount > 0 ? `${attentionCount} need${attentionCount === 1 ? 's' : ''} attention` : '',
        state.notifications === 'desktop' ? '' : state.notifications === 'off' ? 'alerts off' : 'alerts in-app',
        attentionCount > 0 ? '' : 'nothing waiting',
        `${teammates.length} teammate${teammates.length === 1 ? '' : 's'}`,
      ])
  // The status meta wins the header's width over the conversation's title:
  // the reader knows which chat they opened this from, and on a narrow
  // terminal the title used to take 16 columns while "alerts in-app" — which
  // nothing else on screen shows — was the part cut off.
  const metaWidth = headlineMeta ? headlineMeta.length + 5 : 0
  // Still last in line for the width, but no longer capped at 14 cells when
  // the header has a hundred to spare ("Teammates hav…").
  const titleRoom = Math.max(0, Math.min(48, innerW - headline.length - metaWidth - 2))
  const headerTitle = busy ? 'working…' : session && titleRoom >= 6 ? fitText(session.title, titleRoom).trimEnd() : ''
  // The draft row gives the typed text the width first. On a narrow terminal
  // the label used to fill the row and the text drew over its tail, so what
  // the user was typing was the part they could not see. The label shortens,
  // then drops; the text shows its end, where the caret is.
  const draftRow = draft ? fitDraftRow(`${draft.kind === 'delegate' ? 'Ask' : 'Message'} ${draft.toName}: `, `${draft.text}▏`, innerW) : { label: '', text: '' }
  const headlineColor = terminal ? theme.dim
    : attentionCount > 0 ? theme.amber
    : enabled ? theme.green
    : theme.muted

  // Key and label are separate spans so the key carries the accent — one joined
  // dim string gives the reader nothing to scan for.
  const footerHints: Array<[string, string]> = draft
    ? [['⏎', 'send'], ['esc', 'cancel']]
    : confirmCancel
      ? [['y/⏎', 'cancel task'], ['any other key', 'keep it']]
    : confirmOff
      ? [['y/⏎', 'turn off'], ['any other key', 'cancel']]
      : pending
        ? [['r', 'retry same request'], ['⏎', 'inspect'], ['e', 'edit after checking task history'], ['esc', 'close']]
        : !enabled
          ? (teammates.length ? [['j/k', 'move'], ['⏎', 'open transcript'], ['o/O', 'watch'], ['v', 'result review'], ['e', 'new team'], ['esc', 'close']] : canLead ? [['e', 'enable coordinator'], ['esc', 'close']] : [['esc', 'close']])
          : [['j/k', 'move'], ['⏎', 'open'], ['o/O', 'watch'], ['v', 'result review'], ['d', 'ask'], ['m', 'message'],
             ['r', 'resume'], ['i', 'interrupt'], ['⇧X', 'cancel task'], ['p', `new: ${newTeammateProvider ? formatProviderLabel(newTeammateProvider) : 'same'}`], ['c', 'continuation'], ['w', 'worktrees'], ['l', `alerts ${state.notifications}`], ['x', 'turn off'], ['esc', 'close']]
  // Truncation is by whole entries, not mid-word: a hint cut to "x …" tells the
  // reader a key exists without saying which.
  const footerWidth = (hints: Array<[string, string]>) =>
    hints.reduce((total, [key, label]) => total + key.length + label.length + 1, 0)
    + Math.max(hints.length - 1, 0) * 3
  // The LAST entry is how to leave, so drop from the middle rather than the
  // end: a hint that truncates away its own escape hatch is worse than a short
  // one. Same rule the ⌃B/⌃K chord hint follows.
  const visibleHints = [...footerHints]
  while (visibleHints.length > 2 && footerWidth(visibleHints) > innerW) {
    visibleHints.splice(visibleHints.length - 2, 1)
  }

  if (recoveryOpen && session) return <CoordinatorRecovery state={data} sessionId={session.sessionId} provider={session.provider} pendingRequest={pending ? `${pending.action} · ${pending.requestId}` : null} disabled={disabled} theme={theme} width={width} height={height} onClose={() => setRecoveryOpen(false)} onInspect={agentId => { const agent = snapshot?.agents.find(agent => agent.id === agentId); if (agent) onOpenSession(agent) }} onKeyHandlerReady={onKeyHandlerReady} />
  if (resourcesOpen && data?.interactive.resources) return <CoordinatorResources resources={data.interactive.resources} theme={theme} width={width} height={height} onClose={() => setResourcesOpen(false)} onKeyHandlerReady={onKeyHandlerReady} />
  if (workflowOpen && session) return <CoordinatorWorkflow cwd={session.cwd ?? ''} provider={session.provider} theme={theme} width={width} height={height} onClose={() => setWorkflowOpen(false)} onKeyHandlerReady={onKeyHandlerReady} />
  if (resultTaskId && session) return <CoordinatorResultReview key={`${session.provider}:${session.sessionId}:${resultTaskId}`} sessionId={session.sessionId} provider={session.provider} taskId={resultTaskId} theme={theme} width={width} height={height} onClose={() => setResultTaskId(null)} onNotice={onNotice} onKeyHandlerReady={onKeyHandlerReady} />

  return (
    <box
      id="teammates-popover"
      position="absolute"
      top={popTop}
      left={popLeft}
      width={popW}
      height={popH}
      border
      borderStyle="single"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      zIndex={MODAL_CONTENT_Z_INDEX}
      flexDirection="column"
      title=" Teammates "
      titleColor={theme.violet}
      titleAlignment="left"
    >
      <box height={2} paddingX={1} border={['bottom']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        <text fg={headlineColor} wrapMode="none">{headline}</text>
        {headlineMeta ? <text fg={theme.dim} wrapMode="none">{`  ·  ${fitMetaEntries(headlineMeta, innerW - headline.length - 5 - headerTitle.length)}`}</text> : null}
        <box flexGrow={1} />
        <text fg={busy ? theme.cyan : theme.dim} wrapMode="none">{headerTitle}</text>
      </box>

      <scrollbox
        width={popW - 2}
        height={bodyH}
        scrollY
        backgroundColor={theme.surface}
        scrollbarOptions={{ trackOptions: { foregroundColor: theme.dim, backgroundColor: theme.surface } }}
      >
        <box paddingX={1} flexDirection="column">
          {state.loading && !data ? (
            <text fg={theme.dim}>Reading this conversation's coordination state…</text>
          ) : null}

          {pending ? (
            <box flexDirection="column" paddingBottom={1}>
              <text fg={theme.amber} wrapMode="word" width={innerW}>
                {`The last ${pending.action} request is unconfirmed. Retrying replays the same request, which the server reconciles instead of repeating.`}
              </text>
              {error ? <text fg={theme.red} wrapMode="word" width={innerW}>{error}</text> : null}
            </box>
          ) : error ? (
            <box paddingBottom={1}><text fg={theme.red} wrapMode="word" width={innerW}>{error}</text></box>
          ) : null}

          {!enabled && !terminal ? (
            <box flexDirection="column">
              <text fg={theme.text} wrapMode="word" width={innerW}>
                Enable coordination to give this chat a team. Teammates run their own turns; what they
                send back arrives folded into your next message, and you keep every approval.
              </text>
              {canLead ? null : (
                <text fg={theme.dim} wrapMode="word" width={innerW}>
                  This conversation is a teammate in someone else's run, so it cannot lead one.
                </text>
              )}
            </box>
          ) : null}

          {currentAttention ? <box flexDirection="column" paddingBottom={1}>
            <text fg={theme.amber} wrapMode="word" width={innerW}>{`ATTENTION ${Math.min(attentionIndex + 1, items.length)}/${items.length} · ${currentAttention.kind} · ${currentAttention.title}`}</text>
            <text fg={theme.text} wrapMode="word" width={innerW}>{attentionDetail.text}</text>
            {attentionDetail.hidden > 0 ? <text fg={theme.dim} wrapMode="none">{`… ${attentionDetail.hidden} more line${attentionDetail.hidden === 1 ? '' : 's'} · v reads the whole result`}</text> : null}
            <text fg={theme.cyan} wrapMode="word" width={innerW}>{attentionHint(currentAttention, disabled, items.length)}</text>
          </box> : null}

          {unconfirmedDelivery ? (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.amber} wrapMode="word" width={innerW}>
                A previous lead delivery is unconfirmed. Read this conversation's transcript before
                choosing whether its mail arrived.
              </text>
              <text fg={theme.dim} wrapMode="none">{'  y mail arrived   ·   n mail did not arrive — requeue'}</text>
            </box>
          ) : null}

          {roster.counts.all > 0 ? <box flexDirection="column" paddingTop={0}>
            <text fg={searching ? theme.cyan : theme.muted} wrapMode="none">
              {fitText(`TEAMMATES  ${COORDINATOR_ROSTER_LABELS[rosterFilter]} ${teammates.length}/${roster.counts.all} · / find · t state${rosterQuery ? ' · ctrl+u clear' : ''}`, innerW - 1).trimEnd()}
            </text>
            {searching || rosterQuery ? <text fg={theme.text} wrapMode="word" width={innerW}>{`Find: ${rosterQuery}${searching ? '▏ · enter/esc finish' : ''}`}</text> : null}
            {!teammates.length ? <text fg={theme.dim}>No teammates match these filters.</text> : null}
          </box> : null}
          {teammates.length > 0 ? (
            // Explicit zero: this slot is the "none asked yet" row until the
            // first teammate exists, and OpenTUI keeps that row's paddingTop on
            // the reused box unless the next one states its own.
            <box flexDirection="column" paddingTop={0}>
              {rosterAgents.map((agent, rowIndex) => {
                const isLead = agent.id === rosterLead?.id
                const isSelected = isLead ? leadSelected : rowIndex - (rosterLead ? 1 : 0) === clamped
                const accent = getProviderAccent(agent.provider)
                const activity = data ? coordinatorAgentActivity(agent, data, state.observationUnavailable, stalled.includes(agent.id)) : agent.status
                const live = !state.observationUnavailable && !elsewhere && (data?.runningAgentIds.includes(agent.id) || agent.turnActive)
                // The teammate's own last word — dropped when the attention
                // card above or the task row below already says it. Three
                // copies of one sentence is not three pieces of information.
                const rawNote = coordinatorAgentNote(agent, snapshot)
                const note = !isLead && rawNote && rawNote !== currentAttention?.detail ? rawNote : ''
                const needs = data?.permissions.some((item) => item.agentId === agent.id)
                  || recoveries.includes(agent.id) || stalled.includes(agent.id)
                // One row a teammate, read left to right as a sentence: how it
                // stands (the glyph and its colour), who, what task and where
                // that task is, then what the host last saw of it. Everything
                // was one dim grey string before, and "Unavailable · last
                // observation is stale" led a row whose task had finished.
                const provider = formatProviderLabel(agent.provider).toUpperCase()
                const compact = compactRoster
                const task = rosterTaskByAgent.get(agent.id)
                const taskDone = task ? TERMINAL_TASK_STATUSES.has(task.status) : false
                const picker = snapshot ? coordinatorPickerState(agent, snapshot, state.reviewed) : 'idle'
                const mark = isLead ? { glyph: '◆', color: live ? theme.green : accent }
                  : needs || picker === 'blocked' ? { glyph: '!', color: theme.amber }
                  : live || picker === 'working' ? { glyph: '●', color: theme.green }
                  : picker === 'done' ? { glyph: '✓', color: theme.green }
                  : task?.status === 'failed' ? { glyph: '×', color: theme.red }
                  : picker === 'unknown' ? { glyph: '?', color: theme.amber }
                  : { glyph: '○', color: theme.dim }
                const taskStatus = !task ? ''
                  : picker === 'done' ? 'to review'
                  : task.status.replace(/_/g, ' ')
                const taskStatusColor = !task ? theme.dim
                  : task.status === 'failed' ? theme.red
                  : task.status === 'completed' ? theme.green
                  : task.status === 'blocked' ? theme.amber
                  : theme.cyan
                // A session going quiet after its task is done is not news;
                // the same words on a teammate mid-task are.
                const quietActivity = taskDone && /^Unavailable|^Available$|^Finished$/.test(activity) ? '' : activity
                // "this conversation" marks the row for the chat the panel was
                // opened from, lead or teammate. It replaces a bare "Available",
                // which says nothing the open chat does not.
                const here = agent.id === viewingAgentId
                const shownActivity = compact || isLead ? quietActivity : activity
                const status = joinMeta([
                  here && /^Available$|^$/.test(shownActivity) ? '' : shownActivity,
                  here ? 'this conversation' : '',
                  coordinatorAgentWorkspace(agent, snapshot),
                ])
                const name = compact ? fitText(agent.name, rosterNameWidth) : fitText(agent.name, Math.min(agent.name.length, Math.max(innerW - 30, 10))).trimEnd()
                const room = Math.max(innerW - 4 - name.length - 2 - provider.length - 1, 0)
                // The teammate's last word stands in for a task it does not have
                // and rides beside one that is open or failed — a failure's last
                // words are the why. A completed task's are its result, which
                // the attention card already carries.
                const aside = joinMeta([status, note && task?.status !== 'completed' ? `“${note}”` : ''])
                const taskTail = task ? ` · ${taskStatus}` : ''
                const asideText = aside ? `  ${aside}` : ''
                const titleRoom = Math.max(room - taskTail.length - Math.min(asideText.length, Math.floor(room / 2)), 8)
                const taskTitle = task ? fitText(task.title, Math.min(task.title.length, titleRoom)).trimEnd() : ''
                const asideFitted = fitText(asideText, Math.max(room - taskTitle.length - taskTail.length, 0)).trimEnd()
                return (
                  <box
                    key={agent.id}
                    flexDirection="column"
                    backgroundColor={isSelected ? theme.surface3 : theme.surface}
                  >
                    <box flexDirection="row" alignItems="center">
                      <text fg={isSelected ? accent : theme.dim} wrapMode="none">{isSelected ? '▸ ' : '  '}</text>
                      <text fg={mark.color} wrapMode="none">{`${mark.glyph} `}</text>
                      <text fg={theme.text} attributes={isSelected ? TextAttributes.BOLD : undefined} wrapMode="none">{name}</text>
                      {compact && task ? (
                        <>
                          <text fg={taskDone ? theme.muted : theme.text} wrapMode="none">{`  ${taskTitle}`}</text>
                          <text fg={taskStatusColor} wrapMode="none">{taskTail}</text>
                        </>
                      ) : null}
                      {compact && asideFitted ? <text fg={needs ? theme.amber : theme.dim} wrapMode="none">{task ? asideFitted : `  ${asideFitted.trimStart()}`}</text> : null}
                      {!compact && isLead && here ? <text fg={theme.dim} wrapMode="none">{'  this conversation'}</text> : null}
                      <box flexGrow={1} />
                      <text fg={accent} wrapMode="none">{provider}</text>
                    </box>
                    {/* The lead is one row at any width: on a narrow panel its
                        second row would only say "this conversation". */}
                    {compact || isLead ? null : (
                      <box flexDirection="row">
                        <text fg={theme.dim} wrapMode="none">{'    '}</text>
                        <text fg={needs ? theme.amber : theme.dim} wrapMode="none">{fitText(status, innerW - 6)}</text>
                      </box>
                    )}
                    {note && !compact ? (
                      <box flexDirection="row">
                        <text fg={theme.dim} wrapMode="none">{'    '}</text>
                        <text fg={theme.muted} wrapMode="none">{fitText(`“${note}”`, innerW - 6)}</text>
                      </box>
                    ) : null}
                  </box>
                )
              })}
            </box>
          ) : enabled && !roster.counts.all ? (
            <box paddingTop={1} flexDirection="row">
              <text fg={theme.cyan} wrapMode="none">{'d '}</text>
              <text fg={theme.muted} wrapMode="word" width={innerW - 2}>
                asks a teammate for a bounded piece of work. None have been asked yet.
              </text>
            </box>
          ) : null}

          {attention.map((item) => (
            <box key={`${item.agentId}:${item.permission.id}`} flexDirection="row" paddingTop={1}>
              <text fg={theme.amber} wrapMode="none">{'! '}</text>
              <text fg={theme.muted} wrapMode="word" width={innerW - 2}>
                {`${item.agentName}: ${item.permission.title} — ⏎ on the teammate above opens its transcript to answer`}
              </text>
            </box>
          ))}

          {recoveries.map((agentId) => (
            <box key={`recovery:${agentId}`} flexDirection="row" paddingTop={1}>
              <text fg={theme.amber} wrapMode="none">{'⚠ '}</text>
              <text fg={theme.muted} wrapMode="word" width={innerW - 2}>
                {`${teammates.find((agent) => agent.id === agentId)?.name ?? agentId}: execution needs reconciliation — ⏎ to inspect, then r to resume`}
              </text>
            </box>
          ))}

          {enabled && runInfo ? (
            <box flexDirection="column" paddingTop={1}>
              <box flexDirection="row">
                <text fg={theme.muted} wrapMode="none">{'RUN  '}</text>
                <text fg={theme.text} wrapMode="none">{fitText(runInfo.summary, innerW - 5).trimEnd()}</text>
              </box>
              {runInfo.warning ? <text fg={theme.amber} wrapMode="none">{fitText(`⚠ ${runInfo.warning}`, innerW)}</text> : null}
              {runInfo.idleWarning ? <text fg={theme.amber} wrapMode="word" width={innerW}>{`⚠ ${runInfo.idleWarning}`}</text> : null}
              {runInfo.overlapLines.map((line) => <text key={line} fg={theme.amber} wrapMode="none">{fitText(`⚠ ${line}`, innerW)}</text>)}
              {runInfo.holdUpLines.map((line) => <text key={line} fg={theme.muted} wrapMode="none">{fitText(`⚑ ${line}`, innerW)}</text>)}
              {runInfo.hiddenOverlaps ? <text fg={theme.dim} wrapMode="none">{`  +${runInfo.hiddenOverlaps} more overlapping path${runInfo.hiddenOverlaps === 1 ? '' : 's'}`}</text> : null}
            </box>
          ) : null}

          {snapshot && listedTasks.length > 0 ? (
            <box flexDirection="column" paddingTop={enabled && runInfo ? 0 : 1}>
              <text fg={theme.muted} wrapMode="none">{shownTaskIds.size > 0 ? `OTHER TASKS (${listedTasks.length})` : `TASKS (${listedTasks.length})`}</text>
              {listedTasks.slice(-6).map((task) => (
                <box key={task.id} flexDirection="row">
                  <text fg={theme.dim} wrapMode="none">{'  '}</text>
                  <text fg={theme.muted} wrapMode="none">
                    {fitText(joinMeta([task.title, task.status, snapshot.agents.find(agent => agent.id === task.ownerAgentId)?.name]), innerW - 2).trimEnd()}
                  </text>
                </box>
              ))}
            </box>
          ) : null}
          {enabled ? (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.muted} wrapMode="word" width={innerW}>{settingsHeading}</text>
              <box flexDirection="row">
                <text fg={theme.cyan} wrapMode="none">{'c '}</text>
                <text fg={data?.interactive.autoContinue ? theme.green : theme.muted} wrapMode="none">
                  {data?.interactive.autoContinue ? '[x]' : '[ ]'}
                </text>
                <text fg={theme.text} wrapMode="word" width={Math.max(8, innerW - 6)}>{' Continue when teammates respond'}</text>
              </box>
              <box flexDirection="row">
                <text fg={theme.cyan} wrapMode="none">{'w '}</text>
                <text fg={snapshot?.run.useWorktrees !== false ? theme.green : theme.muted} wrapMode="none">
                  {snapshot?.run.useWorktrees !== false ? '[x]' : '[ ]'}
                </text>
                <text fg={theme.text} wrapMode="word" width={Math.max(8, innerW - 6)}>{' Give new teammates their own worktree'}</text>
              </box>
              {data?.interactive.autoContinue && data.interactive.remainingTurns === 0 ? (
                <text fg={theme.amber} wrapMode="word" width={innerW}>
                  Automatic continuation paused after four turns. Send a message to continue.
                </text>
              ) : null}
            </box>
          ) : null}

        </box>
      </scrollbox>

      {draft ? (
        <box height={1} paddingX={1} flexDirection="row">
          <text fg={theme.violet} wrapMode="none">{draftRow.label}</text>
          <text fg={theme.text} wrapMode="none">{draftRow.text}</text>
        </box>
      ) : confirmCancel ? (
        <box height={1} paddingX={1}>
          <text fg={theme.amber} wrapMode="none">
            {(() => {
              // The consequence is the part that must survive a narrow terminal, so it is the part that never gets cut.
              const full = `Cancel ${confirmCancel.taskId} “${confirmCancel.title}” for ${confirmCancel.agentName}? Locks are released and dependents fail.`
              const medium = `Cancel ${confirmCancel.taskId}? Locks release; dependents fail.`
              return full.length <= innerW ? full : medium.length <= innerW ? medium : fitText(`Cancel ${confirmCancel.taskId}? dependents fail`, innerW)
            })()}
          </text>
        </box>
      ) : confirmOff ? (
        <box height={1} paddingX={1}>
          <text fg={theme.amber} wrapMode="none">
            {fitText(teardownWarning(teardown) ?? 'Turn off coordination? Teammate work stops; this conversation and its history stay.', innerW)}
          </text>
        </box>
      ) : null}

      <box height={2} paddingX={1} border={['top']} borderStyle="single" borderColor={theme.border} flexDirection="row" alignItems="center">
        {visibleHints.map(([key, label], hintIndex) => (
          <box key={key} flexDirection="row">
            {hintIndex > 0 ? <text fg={theme.dim} wrapMode="none">{' · '}</text> : null}
            <text fg={theme.cyan} wrapMode="none">{key}</text>
            <text fg={theme.muted} wrapMode="none">{` ${label}`}</text>
          </box>
        ))}
      </box>
    </box>
  )
})

function attentionHint(item: CoordinatorAttentionItem, disabled: boolean, items: number): string {
  const action = item.kind === 'result' ? 'v review result · s mark reviewed'
    : disabled ? ''
    : item.kind === 'plan' ? 'a approve plan · v request revision'
    : ['decision', 'message', 'blocker'].includes(item.kind) ? 'b reply'
    : 'Review in Agent Operations'
  // `[ / ]` read as an empty checkbox beside the real ones two rows below.
  return [items > 1 ? '[ or ] for the next' : '', action].filter(Boolean).join(' · ')
}
