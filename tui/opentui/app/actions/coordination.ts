/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { isPluginEnabled } from '../../../../lib/plugins/enablement'
import { type TextareaRenderable } from '@opentui/core'
import { startTuiProtocolRun, type TuiSessionDetail } from '../../../../lib/tui/service'
import { type PlaybookSummary, type ProtocolAutonomy } from '../../../../lib/agentProtocol'
import { type ProviderSelection, type Session } from '../../../../lib/types'
import { type TuiEffort, type NoticeTone } from '../types'
import { sessionKey } from '../sessionList'
import { parseCoordContractLines } from '../pickers'
import { writeTuiSplitPanes } from '../../../../lib/tui/service'
import { type ProtocolAgent } from '../../../../lib/agentProtocol'
import { join } from 'node:path'
import { calculateSplitPaneLayout, resolveCoordinationTranscriptTarget, type SplitPaneOrientation, planTeammateWatch } from '../../splitPaneState'
import { MIN_READER_WIDTH, SPLIT_PANE_MAX, SPLIT_PANE_MIN_WIDTH, SPLIT_PANE_MIN_ROWS, MIN_READER_ROWS } from '../layoutConstants'
import { type MutableRefObject } from 'react'
import { type WindowSplitTree, type WindowSplitNode } from '../../windowSplitTree'
import { planCoordinatorWorkspace } from '../../coordinatorWorkspace'
import { type ProtocolRunSnapshot } from '../../../../lib/agentProtocol'
import { type PaneFocus } from '../types'
import { keepEmpty } from '../collections'
import { openInteractiveCoordinator } from '../../interactiveCoordinatorStore'

export type SubmitCoordinatedRunContext = {
  coordTextareaRef: React.RefObject<TextareaRenderable | null>
  coordDraft: string
  coordPlaybookName: string | null
  coordPlaybooks: PlaybookSummary[]
  coordPlaybookArgsDraft: string
  coordStartInFlightRef: React.RefObject<boolean>
  setCoordBusy: React.Dispatch<React.SetStateAction<boolean>>
  setCoordError: React.Dispatch<React.SetStateAction<string | null>>
  provider: ProviderSelection
  selectedSession: Session | null
  coordProviderOverride: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | null
  coordTeammateProviderOverride: ('claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp')[] | null
  sessionDetail: TuiSessionDetail | null
  coordMaxAgents: number
  tuiModelOverride: Record<string, string>
  selectedSessionKey: string | null
  tuiEffort: TuiEffort
  coordGateDraft: string
  coordRequirePlanApproval: boolean
  coordAutonomy: ProtocolAutonomy
  coordRequireReview: boolean
  coordAcceptanceDraft: string
  coordNonGoalsDraft: string
  coordManualQaDraft: string
  coordEscalationDraft: string
  coordMaxTokens: string
  coordMaxDurationMinutes: string
  coordUseWorktrees: boolean
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setCoordModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setCoordBoardRunId: React.Dispatch<React.SetStateAction<string | null>>
  setPluginOverlay: React.Dispatch<React.SetStateAction<'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'terminal' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setCoordDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordAcceptanceDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordNonGoalsDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordManualQaDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordEscalationDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordPlaybookName: React.Dispatch<React.SetStateAction<string | null>>
  setCoordPlaybookArgsDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordGateDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordMaxTokens: React.Dispatch<React.SetStateAction<string>>
  setCoordMaxDurationMinutes: React.Dispatch<React.SetStateAction<string>>
  setCoordProviderOverride: React.Dispatch<React.SetStateAction<'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | null>>
  setCoordTeammateProviderOverride: React.Dispatch<React.SetStateAction<('claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp')[] | null>>
  setCoordProviderPoolIndex: React.Dispatch<React.SetStateAction<number>>
  setCoordModalFocus: React.Dispatch<React.SetStateAction<'provider' | 'review' | 'agents' | 'prompt' | 'acceptance' | 'nonGoals' | 'manualQa' | 'escalation' | 'playbook' | 'playbookArgs' | 'pool' | 'tokenBudget' | 'durationBudget' | 'worktrees' | 'gate' | 'autonomy' | 'plans' | 'launch'>>
  coordWatchStateRef: React.RefObject<Map<string, { status: string; blockedAgents: Set<string>; }>>
  setCoordWatchIds: React.Dispatch<React.SetStateAction<string[]>>
  refreshSessions: (nextProvider: ProviderSelection, preserveSelection?: boolean, foreground?: boolean) => Promise<void>
}

export async function runSubmitCoordinatedRun(ctx: SubmitCoordinatedRunContext) {
  const {
    coordTextareaRef, coordDraft, coordPlaybookName, coordPlaybooks, coordPlaybookArgsDraft,
    coordStartInFlightRef, setCoordBusy, setCoordError, provider, selectedSession,
    coordProviderOverride, coordTeammateProviderOverride, sessionDetail, coordMaxAgents,
    tuiModelOverride, selectedSessionKey, tuiEffort, coordGateDraft, coordRequirePlanApproval,
    coordAutonomy, coordRequireReview, coordAcceptanceDraft, coordNonGoalsDraft,
    coordManualQaDraft, coordEscalationDraft, coordMaxTokens, coordMaxDurationMinutes,
    coordUseWorktrees, setOpenTabSessions, setSelectedSessionKey, setCoordModalOpen,
    setCoordBoardRunId, setPluginOverlay, showNotice, setCoordDraft, setCoordAcceptanceDraft,
    setCoordNonGoalsDraft, setCoordManualQaDraft, setCoordEscalationDraft, setCoordPlaybookName,
    setCoordPlaybookArgsDraft, setCoordGateDraft, setCoordMaxTokens, setCoordMaxDurationMinutes,
    setCoordProviderOverride, setCoordTeammateProviderOverride, setCoordProviderPoolIndex,
    setCoordModalFocus, coordWatchStateRef, setCoordWatchIds, refreshSessions,
  } = ctx
  // The textarea is the source of truth — onContentChange can lag onSubmit.
  const prompt = (coordTextareaRef.current?.plainText ?? coordDraft).trim()
  const selectedPlaybook = coordPlaybookName
    ? coordPlaybooks.find((entry) => entry.name === coordPlaybookName)
    : null
  const playbookArgsText = coordPlaybookArgsDraft.trim()
  if ((!prompt && !selectedPlaybook) || (selectedPlaybook?.expectsArgs && !playbookArgsText) || coordStartInFlightRef.current) return
  let playbookArgs: unknown = undefined
  if (playbookArgsText) {
    try { playbookArgs = JSON.parse(playbookArgsText) } catch { playbookArgs = playbookArgsText }
  }
  coordStartInFlightRef.current = true
  setCoordBusy(true)
  setCoordError(null)
  try {
    const suggestedProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
    const targetProvider = coordProviderOverride ?? suggestedProvider
    const teammateProviders = coordTeammateProviderOverride ?? [targetProvider]
    const baseCwd = selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()
    const result = await startTuiProtocolRun({
      prompt,
      baseCwd,
      playbookName: selectedPlaybook?.name,
      playbookArgs,
      provider: targetProvider,
      teammateProviders,
      maxAgents: coordMaxAgents,
      title: (prompt || selectedPlaybook?.name || 'Coordinated run').slice(0, 40),
      model: tuiModelOverride[selectedSessionKey ?? ''] || undefined,
      effort: tuiEffort === 'auto' ? undefined : tuiEffort,
      gateCommand: coordGateDraft.trim() || undefined,
      requirePlanApproval: coordRequirePlanApproval,
      autonomy: coordAutonomy,
      requireReview: coordRequireReview,
      acceptanceContract: {
        goal: prompt || selectedPlaybook?.name || 'Complete the coordinated workflow',
        userVisibleAcceptance: parseCoordContractLines(coordAcceptanceDraft),
        nonGoals: parseCoordContractLines(coordNonGoalsDraft),
        verificationCommands: [coordGateDraft.trim()].filter(Boolean),
        manualQa: parseCoordContractLines(coordManualQaDraft),
        escalationTriggers: parseCoordContractLines(coordEscalationDraft),
      },
      budget: coordMaxTokens.trim() || coordMaxDurationMinutes.trim() ? {
        maxTokens: coordMaxTokens.trim() ? Number(coordMaxTokens) : undefined,
        maxDurationMinutes: coordMaxDurationMinutes.trim() ? Number(coordMaxDurationMinutes) : undefined,
      } : undefined,
      useWorktrees: coordUseWorktrees,
    })
    const drafts: Session[] = result.sessions.map((session) => ({
      sessionId: session.sessionId,
      provider: session.provider,
      cwd: session.cwd,
      createdAt: Date.now(),
      lastModified: Date.now(),
      summary: session.summary,
      isPending: session.isPending,
    }))
    setOpenTabSessions((prev) => {
      const seen = new Set(prev.map((tab) => sessionKey(tab)))
      const next = [...prev]
      for (const draft of drafts) {
        if (!seen.has(sessionKey(draft))) next.push(draft)
      }
      return next
    })
    const first = drafts[0]
    if (first) setSelectedSessionKey(sessionKey(first))
    setCoordModalOpen(false)
    setCoordBoardRunId(result.snapshot.run.id)
    // The run is started either way; only its view may be off.
    if (isPluginEnabled('coordination')) setPluginOverlay('coordination')
    else showNotice('info', 'Run started · the control center is off (Plugins, ⌃K palette)')
    setCoordDraft('')
    setCoordAcceptanceDraft('')
    setCoordNonGoalsDraft('')
    setCoordManualQaDraft('')
    setCoordEscalationDraft('')
    setCoordPlaybookName(null)
    setCoordPlaybookArgsDraft('')
    setCoordGateDraft('')
    setCoordMaxTokens('')
    setCoordMaxDurationMinutes('')
    setCoordProviderOverride(null)
    setCoordTeammateProviderOverride(null)
    setCoordProviderPoolIndex(0)
    setCoordModalFocus('prompt')
    // Watch the run in the background: the engineer gets notified on
    // completion or newly blocked teammates even with the board closed.
    coordWatchStateRef.current.set(result.snapshot.run.id, {
      status: result.snapshot.run.status,
      blockedAgents: new Set(),
    })
    setCoordWatchIds((prev) => [...prev, result.snapshot.run.id])
    await refreshSessions(provider, true, false)
    showNotice(
      'info',
      selectedPlaybook
        ? `Playbook ${selectedPlaybook.name} started — task board seeded without a planning turn`
        : 'Coordinated run started — lead is planning the task board',
      5000,
    )
  } catch (err) {
    setCoordError(err instanceof Error ? err.message : 'Failed to start coordinated run')
    showNotice('error', err instanceof Error ? err.message : 'Failed to start coordinated run')
  } finally {
    coordStartInFlightRef.current = false
    setCoordBusy(false)
  }
}

export type WatchCoordinationAgentSessionsContext = {
  sessionsByKeyRef: React.RefObject<Map<string, Session>>
  selectedSessionKey: string | null
  splitPinnedKeys: string[]
  splitPaneCount: number
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
  setSplitPaneCount: React.Dispatch<React.SetStateAction<number>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  splitOrientation: SplitPaneOrientation
  mainContentHeight: number
  readerAreaWidth: number
  splitReaderShare: number
}

export function runWatchCoordinationAgentSessions(ctx: WatchCoordinationAgentSessionsContext, agents: ProtocolAgent[]) {
  const {
    sessionsByKeyRef, selectedSessionKey, splitPinnedKeys, splitPaneCount, showNotice,
    setOpenTabSessions, setSplitPinnedKeys, setSplitPaneCount, setError, splitOrientation,
    mainContentHeight, readerAreaWidth, splitReaderShare,
  } = ctx
  const targets: Array<{ sessionKey: string; session: Session; name: string }> = []
  let refusal: string | null = null
  for (const agent of agents) {
    const target = resolveCoordinationTranscriptTarget(agent, sessionsByKeyRef.current, Date.now())
    if (target.kind === 'unreadable') refusal ??= target.reason
    else targets.push({ sessionKey: target.sessionKey, session: target.session, name: agent.name })
  }
  const plan = planTeammateWatch({
    targets,
    selectedSessionKey,
    currentPins: splitPinnedKeys,
    currentCount: splitPaneCount,
    maxPanes: SPLIT_PANE_MAX,
  })
  if (plan.watched.length === 0) {
    showNotice('info', refusal ?? 'That teammate is already in the reader', 5000)
    return
  }
  setOpenTabSessions((prev) => {
    const missing = plan.watched.filter((entry) => !prev.some((tab) => sessionKey(tab) === entry.sessionKey))
    return missing.length ? [...prev, ...missing.map((entry) => entry.session)] : prev
  })
  setSplitPinnedKeys(plan.pins)
  // Set directly rather than through applySplitPaneCount, which projects the
  // layout from this render's tab list — one that does not hold these tabs yet.
  if (plan.count !== splitPaneCount) {
    setSplitPaneCount(plan.count)
    void writeTuiSplitPanes(plan.count).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to store split view setting')
    })
  }
  // Say what will actually be on screen: a narrow terminal drops panes
  // before it squeezes the reader, and "watching" a teammate with no pane
  // would be a claim the frame does not back.
  const stacked = splitOrientation === 'rows'
  const visible = calculateSplitPaneLayout({
    availableExtent: stacked ? Math.max(mainContentHeight - 2, 8) : readerAreaWidth,
    requestedCount: plan.count,
    availableCount: plan.count,
    maxPanes: SPLIT_PANE_MAX,
    minPaneExtent: stacked ? SPLIT_PANE_MIN_ROWS : SPLIT_PANE_MIN_WIDTH,
    minReaderExtent: stacked ? MIN_READER_ROWS : MIN_READER_WIDTH,
    readerShare: splitReaderShare,
  }).visibleCount
  const shown = plan.watched.slice(0, Math.max(visible, 0))
  const hidden = plan.watched.length - shown.length + plan.skipped
  showNotice('info', shown.length
    ? `Watching ${shown.map((entry) => entry.name).join(', ')}${hidden > 0 ? ` · ${hidden} more need${hidden === 1 ? 's' : ''} room (${stacked ? 'taller terminal' : '⌃B " to stack'} or ←/→ tabs)` : ''} · ⌃B x close`
    : `Opened ${plan.watched.map((entry) => entry.name).join(', ')} as tabs · no room for a pane (${stacked ? 'taller terminal' : '⌃B " to stack'})`, 5000)
}

export type WatchCoordinatorRunContext = {
  sessionsByKeyRef: React.RefObject<Map<string, Session>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  checkpointWindowLayout: () => void
  watchedRosterRef: React.MutableRefObject<{ runId: string; keys: Set<string>; } | null>
  setCoordinatorWorkspace: React.Dispatch<React.SetStateAction<ProtocolRunSnapshot | null>>
  setCoordinatorWorkspaceRunId: React.Dispatch<React.SetStateAction<string | null>>
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  selectTabSession: (session: Session) => void
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
  setSplitPaneCount: React.Dispatch<React.SetStateAction<number>>
  setWindowOrder: React.Dispatch<React.SetStateAction<string[]>>
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
  setWindowSurfaces: React.Dispatch<React.SetStateAction<string[]>>
  setWindowZoom: React.Dispatch<React.SetStateAction<number | 'reader' | null>>
  setWindowSurfacePeek: React.Dispatch<React.SetStateAction<string | null>>
  setFullscreenMode: React.Dispatch<React.SetStateAction<boolean>>
  setSplitFocusIndex: React.Dispatch<React.SetStateAction<number | null>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
}

export function runWatchCoordinatorRun(ctx: WatchCoordinatorRunContext, snapshot: ProtocolRunSnapshot) {
  const {
    sessionsByKeyRef, showNotice, checkpointWindowLayout, watchedRosterRef,
    setCoordinatorWorkspace, setCoordinatorWorkspaceRunId, setOpenTabSessions, selectTabSession,
    setSplitPinnedKeys, setSplitPaneCount, setWindowOrder, setWindowSplitTree, setWindowSurfaces,
    setWindowZoom, setWindowSurfacePeek, setFullscreenMode, setSplitFocusIndex, setFocusedPane,
  } = ctx
  const plan = planCoordinatorWorkspace(snapshot, sessionsByKeyRef.current)
  if (!plan.lead) { showNotice('info', 'This run has no readable lead transcript', 5000); return }
  checkpointWindowLayout()
  watchedRosterRef.current = { runId: snapshot.run.id, keys: new Set(plan.targets.map(target => target.sessionKey)) }
  setCoordinatorWorkspace(snapshot)
  setCoordinatorWorkspaceRunId(snapshot.run.id)
  const lead = plan.lead
  const panes = plan.targets.filter(target => target.sessionKey !== lead.sessionKey)
  setOpenTabSessions(current => {
    const keys = new Set(current.map(sessionKey))
    return [...current, ...plan.targets.filter(target => !keys.has(target.sessionKey)).map(target => target.session)]
  })
  selectTabSession(lead.session)
  // The lead's window on the left, teammates stacked beside it.
  const keys = [lead.sessionKey, ...panes.map(target => target.sessionKey)]
  const stack = (first: number, count: number): WindowSplitNode => count <= 1
    ? { slot: first } : { axis: 'y', ratio: 1 / count, first: { slot: first }, second: stack(first + 1, count - 1) }
  setSplitPinnedKeys(keys)
  setSplitPaneCount(keys.length)
  setWindowOrder(keys)
  setWindowSplitTree({ primary: false, keys, root: panes.length ? { axis: 'x', ratio: 0.55, first: { slot: 0 }, second: stack(1, panes.length) } : { slot: 0 } })
  setWindowSurfaces(keepEmpty)
  setWindowZoom(null)
  setWindowSurfacePeek(null)
  setFullscreenMode(false)
  setSplitFocusIndex(null)
  setFocusedPane('messages')
  showNotice('info', `Watching this run · lead + ${panes.length} teammate${panes.length === 1 ? '' : 's'} · ⌃B p switch · ⌃B a attention · ⌃B w save${plan.skipped.length ? ` · ${plan.skipped.length} unreadable participant(s) skipped` : ''}`, 7000)
}

export type OpenTeammatesPanelContext = {
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  selectedSession: Session | null
}

export function runOpenTeammatesPanel(ctx: OpenTeammatesPanelContext) {
  const {
    showNotice, selectedSession,
  } = ctx
  if (!isPluginEnabled('coordination')) {
    showNotice('info', 'Teammates are off · turn Coordination on in Plugins (⌃K palette)')
    return
  }
  const session = selectedSession
  if (!session) {
    showNotice('info', 'Open a conversation before giving it teammates', 3500)
    return
  }
  if (session.isPending) {
    showNotice('info', 'Send a first message before giving this conversation teammates', 4000)
    return
  }
  // The attention badge observes this conversation without opening the panel.
  // Opening it here reuses that feed and preserves the reader's draft.
  openInteractiveCoordinator({
    sessionId: session.sessionId,
    provider: session.provider ?? 'claude',
    cwd: session.cwd,
    title: session.customTitle ?? session.summary ?? '(untitled session)',
  })
}
