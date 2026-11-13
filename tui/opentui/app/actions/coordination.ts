/** @jsxImportSource @opentui/react */
import type { PluginSurfaceId } from '../../../../lib/plugins/catalog'
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
