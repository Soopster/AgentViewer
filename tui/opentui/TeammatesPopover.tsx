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
import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { TuiThemePalette } from '../theme'
import { getProviderAccent } from '../theme'
import { formatProviderLabel } from '../format'
import type { AgentProvider } from '../../lib/types'

/** Providers a chat can staff a NEW teammate from; cycled with `p`. */
const COORDINATOR_TEAMMATE_PROVIDERS: readonly AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi']
import { fitText, joinMeta } from './textLayout'
import { MODAL_CONTENT_Z_INDEX } from './layers'
import type { ProtocolAgent } from '../../lib/agentProtocol'
import { coordinatorAttention, type CoordinatorAttentionItem } from '../../lib/coordinatorAttention'
import { coordinatorResultIdsForAgent, coordinatorRosterOrder } from '../../lib/coordinatorSignals'
import { coordinatorAgentActivity, coordinatorAgentNote, coordinatorAgentWorkspace, coordinatorStalledAgentIds } from '../../lib/coordinatorInteractiveState'
import {
  closeInteractiveCoordinator,
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
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  onKeyHandlerReady: (handler: (key: TeammatesKeyEvent) => void) => void
}

/** Composing a task or a message; `to` is null for "any available teammate". */
type Draft = { kind: 'delegate' | 'message' | 'decision'; to: string | null; toName: string; text: string; taskId?: string; decisionId?: string; inReplyTo?: string }

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'stopped'])

// The board owns every keystroke while it is open (App.tsx forwards raw keys
// here rather than letting a focused OpenTUI <input> see them), so the draft
// field is built from key events like CoordinationPopover's message composer.
function isPrintable(key: TeammatesKeyEvent): boolean {
  return !key.ctrl && Array.from(key.sequence).length === 1 && key.sequence >= ' '
}

export const TeammatesPopover = memo(function TeammatesPopover({
  theme, width, height, onOpenSession, onNotice, onKeyHandlerReady,
}: Props) {
  const state = useSyncExternalStore(
    subscribeInteractiveCoordinator, getInteractiveCoordinatorState, getInteractiveCoordinatorState,
  )
  // Selection is by teammate id: the roster reorders by attention, and a
  // positional index would silently retarget `m` or `r` to whoever moved there.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [attentionIndex, setAttentionIndex] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)
  // Provider for the NEXT new teammate; an existing one keeps its own. `null`
  // means the lead conversation's provider.
  const [newTeammateProvider, setNewTeammateProvider] = useState<AgentProvider | null>(null)

  const { data, session, busy, pending, error } = state
  const snapshot = data?.snapshot ?? null
  const enabled = data?.interactive.enabled ?? false
  const terminal = snapshot ? TERMINAL_RUN_STATUSES.has(snapshot.run.status) : false
  // Only the lead conversation may drive the run; a teammate's own transcript
  // opened in the reader must not offer to turn the room off.
  const canLead = !snapshot
    || snapshot.agents.some((agent) => agent.role === 'lead' && agent.sessionId === session?.sessionId)

  const teammates = useMemo(() => coordinatorRosterOrder(data, state.reviewed), [data, state.reviewed])
  const clamped = Math.max(teammates.findIndex((agent) => agent.id === selectedId), 0)
  const selected = teammates[clamped] ?? null
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
    if (draft) {
      if (key.name === 'paste') { setDraft({ ...draft, text: (draft.text + key.sequence.replace(/\r\n?/g, '\n')).slice(0, 8000) }); return }
      if (key.name === 'escape') { setDraft(null); return }
      if (key.name === 'return') {
        const text = draft.text.trim()
        if (!text) { setDraft(null); return }
        act(draft.kind === 'delegate'
          ? { action: 'delegate', detail: text, to: draft.to ?? 'auto', teammateProvider: draft.to ? undefined : newTeammateProvider ?? undefined }
          : { action: draft.kind, detail: text, to: draft.to ?? undefined, taskId: draft.taskId, decisionId: draft.decisionId, inReplyTo: draft.inReplyTo },
          draft.kind === 'delegate' ? `Task sent to ${draft.toName}` : `Message sent to ${draft.toName}`)
        setDraft(null)
        return
      }
      if (key.name === 'backspace') { setDraft({ ...draft, text: Array.from(draft.text).slice(0, -1).join('') }); return }
      if (isPrintable(key)) setDraft({ ...draft, text: (draft.text + key.sequence).slice(0, 8000) })
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
    if (key.name === 'return' && selected) {
      reviewInteractiveCoordinatorResults(coordinatorResultIdsForAgent(snapshot, selected.id))
      onOpenSession(selected); closeInteractiveCoordinator(); return
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
      setSelectedId(teammates[Math.max(clamped - 1, 0)]?.id ?? null)
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
    if (key.name === 'x' && !disabled) { setConfirmOff(true); return }
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
      setDraft({ kind: 'delegate', to: null, toName: 'an available teammate', text: '' })
      return
    }
    // Cycle which provider a NEW teammate is staffed from — a Codex reviewer
    // beside a Claude implementer is the point of routing work by provider.
    if (key.name === 'p' && !disabled) {
      setNewTeammateProvider((current) => {
        const index = current === null ? 0 : COORDINATOR_TEAMMATE_PROVIDERS.indexOf(current) + 1
        const next = index >= COORDINATOR_TEAMMATE_PROVIDERS.length ? null : COORDINATOR_TEAMMATE_PROVIDERS[index]!
        onNotice('info', next ? `New teammates use ${formatProviderLabel(next)}` : 'New teammates use this conversation\'s provider', 3000)
        return next
      })
      return
    }
    if (key.name === 'm' && selected && !disabled) {
      setDraft({ kind: 'message', to: selected.id, toName: selected.name, text: '' })
    }
  }, [act, busy, canLead, confirmOff, data, disabled, draft, enabled, locked, onNotice, onOpenSession,
      pending, recoveries, selected, teammates, clamped, snapshot, terminal, unconfirmedDelivery, currentAttention, items.length])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const popW = Math.min(width - 4, 96)
  const popH = Math.min(height - 4, 32)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = popW - 4
  // Header 2 + footer 2 + the box's own border 2, plus the draft/confirm row
  // when it is showing — the scrollbox has a fixed height budget, so a row that
  // appears without being subtracted here pushes the footer off the frame.
  const bodyH = Math.max(popH - 6 - (draft || confirmOff ? 1 : 0), 6)

  const attentionCount = items.length + attention.length + recoveries.length + stalled.length + (unconfirmedDelivery ? 1 : 0)
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
    : joinMeta([
        `${teammates.length} teammate${teammates.length === 1 ? '' : 's'}`,
        attentionCount > 0 ? `${attentionCount} need${attentionCount === 1 ? 's' : ''} attention` : 'nothing waiting',
        // A non-default alert mode is stated where it cannot be truncated away:
        // silenced alerts that nothing on screen admits to look like a bug.
        state.notifications === 'desktop' ? '' : state.notifications === 'off' ? 'alerts off' : 'alerts in-app',
      ])
  const headlineColor = terminal ? theme.dim
    : attentionCount > 0 ? theme.amber
    : enabled ? theme.green
    : theme.muted

  // Key and label are separate spans so the key carries the accent — one joined
  // dim string gives the reader nothing to scan for.
  const footerHints: Array<[string, string]> = draft
    ? [['⏎', 'send'], ['esc', 'cancel']]
    : confirmOff
      ? [['y/⏎', 'turn off'], ['any other key', 'cancel']]
      : pending
        ? [['r', 'retry same request'], ['⏎', 'inspect'], ['e', 'edit after checking task history'], ['esc', 'close']]
        : !enabled
          ? (teammates.length ? [['j/k', 'move'], ['⏎', 'open transcript'], ['e', 'new team'], ['esc', 'close']] : canLead ? [['e', 'enable coordinator'], ['esc', 'close']] : [['esc', 'close']])
          : [['j/k', 'move'], ['⏎', 'open'], ['d', 'ask'], ['m', 'message'],
             ['r', 'resume'], ['i', 'interrupt'], ['p', `new: ${newTeammateProvider ? formatProviderLabel(newTeammateProvider) : 'same'}`], ['c', 'continuation'], ['w', 'worktrees'], ['l', `alerts ${state.notifications}`], ['x', 'turn off'], ['esc', 'close']]
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
        {headlineMeta ? <text fg={theme.dim} wrapMode="none">{`  ·  ${fitText(headlineMeta, innerW - headline.length - 18).trimEnd()}`}</text> : null}
        <box flexGrow={1} />
        <text fg={busy ? theme.cyan : theme.dim} wrapMode="none">{busy ? 'working…' : session ? fitText(session.title, 14).trimEnd() : ''}</text>
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
            <text fg={theme.text} wrapMode="word" width={innerW}>{currentAttention.detail}</text>
            <text fg={theme.cyan} wrapMode="word" width={innerW}>{attentionHint(currentAttention, disabled)}</text>
          </box> : null}

          {enabled ? (
            <box flexDirection="column">
              <box flexDirection="row">
                <text fg={theme.cyan} wrapMode="none">{'c '}</text>
                <text fg={data?.interactive.autoContinue ? theme.green : theme.muted} wrapMode="none">
                  {data?.interactive.autoContinue ? '[x]' : '[ ]'}
                </text>
                <text fg={theme.text} wrapMode="none">{' Continue when teammates respond'}</text>
              </box>
              <box flexDirection="row">
                <text fg={theme.cyan} wrapMode="none">{'w '}</text>
                <text fg={snapshot?.run.useWorktrees !== false ? theme.green : theme.muted} wrapMode="none">
                  {snapshot?.run.useWorktrees !== false ? '[x]' : '[ ]'}
                </text>
                <text fg={theme.text} wrapMode="none">{' Give new teammates their own worktree'}</text>
              </box>
              {data?.interactive.autoContinue && data.interactive.remainingTurns === 0 ? (
                <text fg={theme.amber} wrapMode="word" width={innerW}>
                  Automatic continuation paused after four turns. Send a message to continue.
                </text>
              ) : null}
            </box>
          ) : null}

          {unconfirmedDelivery ? (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.amber} wrapMode="word" width={innerW}>
                A previous lead delivery is unconfirmed. Read this conversation's transcript before
                choosing whether its mail arrived.
              </text>
              <text fg={theme.dim} wrapMode="none">{'  y mail arrived   ·   n mail did not arrive — requeue'}</text>
            </box>
          ) : null}

          {teammates.length > 0 ? (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.muted} wrapMode="none">TEAMMATES</text>
              {teammates.map((agent, agentIndex) => {
                const isSelected = agentIndex === clamped
                const accent = getProviderAccent(agent.provider)
                const activity = data ? coordinatorAgentActivity(agent, data, state.observationUnavailable, stalled.includes(agent.id)) : agent.status
                const live = !state.observationUnavailable && !elsewhere && (data?.runningAgentIds.includes(agent.id) || agent.turnActive)
                // The teammate's own last word, when it adds to the state label.
                const note = coordinatorAgentNote(agent, snapshot)
                const needs = data?.permissions.some((item) => item.agentId === agent.id)
                  || recoveries.includes(agent.id) || stalled.includes(agent.id)
                return (
                  <box
                    key={agent.id}
                    flexDirection="column"
                    backgroundColor={isSelected ? theme.surface3 : theme.surface}
                  >
                    <box flexDirection="row" alignItems="center">
                      <text fg={isSelected ? accent : theme.dim} wrapMode="none">{isSelected ? '▸ ' : '  '}</text>
                      <text fg={needs ? theme.amber : live ? theme.green : theme.dim} wrapMode="none">
                        {`${live ? '●' : '○'} `}
                      </text>
                      <text fg={isSelected ? theme.text : theme.muted} wrapMode="none">
                        {fitText(agent.name, Math.max(innerW - 30, 10))}
                      </text>
                      <box flexGrow={1} />
                      <text fg={accent} wrapMode="none">{formatProviderLabel(agent.provider).toUpperCase()}</text>
                    </box>
                    <box flexDirection="row">
                      <text fg={theme.dim} wrapMode="none">{'    '}</text>
                      <text fg={needs ? theme.amber : theme.dim} wrapMode="none">
                        {fitText(joinMeta([activity, coordinatorAgentWorkspace(agent, snapshot)]), innerW - 6)}
                      </text>
                    </box>
                    {note ? (
                      <box flexDirection="row">
                        <text fg={theme.dim} wrapMode="none">{'    '}</text>
                        <text fg={theme.muted} wrapMode="none">{fitText(`“${note}”`, innerW - 6)}</text>
                      </box>
                    ) : null}
                  </box>
                )
              })}
            </box>
          ) : enabled ? (
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

          {snapshot && snapshot.tasks.length > 0 ? (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.muted} wrapMode="none">{`TASKS (${snapshot.tasks.length})`}</text>
              {snapshot.tasks.slice(-6).map((task) => (
                <box key={task.id} flexDirection="row">
                  <text fg={theme.dim} wrapMode="none">{'  '}</text>
                  <text fg={theme.muted} wrapMode="none">{fitText(joinMeta([task.title, task.status]), innerW - 2).trimEnd()}</text>
                </box>
              ))}
            </box>
          ) : null}
        </box>
      </scrollbox>

      {draft ? (
        <box height={1} paddingX={1} flexDirection="row">
          <text fg={theme.violet} wrapMode="none">
            {`${draft.kind === 'delegate' ? 'Ask' : 'Message'} ${draft.toName}: `}
          </text>
          <text fg={theme.text} wrapMode="none">{`${draft.text}▏`}</text>
        </box>
      ) : confirmOff ? (
        <box height={1} paddingX={1}>
          <text fg={theme.amber} wrapMode="none">
            {fitText('Turn off coordination? Teammate work stops; this conversation and its history stay.', innerW)}
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

function attentionHint(item: CoordinatorAttentionItem, disabled: boolean): string {
  const action = item.kind === 'result' ? 's mark reviewed'
    : disabled ? ''
    : item.kind === 'plan' ? 'a approve plan · v request revision'
    : ['decision', 'message', 'blocker'].includes(item.kind) ? 'b reply'
    : 'Review in Agent Operations'
  return ['[ / ] select attention', action].filter(Boolean).join(' · ')
}
