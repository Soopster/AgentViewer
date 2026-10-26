import { beginProviderLoading } from '../providerLoading'
import { isAgentProvider } from '../provider'
import { getProviderManifest } from '../extensions/providers/catalog'
import {
  buildThreadedMessages,
  buildThreadedMessagesIncremental,
  type IncrementalThreadingCache,
  type ThreadedMessage,
} from '../threading'
import { withSessionInstance } from '../sessionInstances'
import { getConfiguredProvider, getConfiguredProviderTarget, setConfiguredProviderTarget } from '../providerState'
import { peekClaudePlanLimits, readClaudePlanLimits, type ClaudePlanLimits } from '../claudePlanLimits'
import { updateSessionInboxState } from '../sessionInbox'
import type { SessionInboxState } from '../types'
import {
  getConfiguredTuiDensity,
  getConfiguredTuiDiffLayout,
  getConfiguredTuiFocusMode,
  getConfiguredTuiStickyHeaders,
  getConfiguredTuiLightweightWindows,
  getConfiguredTuiRailVisible,
  getConfiguredTuiSessionReaderState,
  getConfiguredTuiSidebarSort,
  getConfiguredTuiSidebarWidth,
  getConfiguredTuiShowToolCalls,
  getConfiguredTuiTabsEnabled,
  getConfiguredTuiTabOrientation,
  getConfiguredTuiSplitPanes,
  getConfiguredTuiSplitOrientation,
  getConfiguredTuiSplitReaderShare,
  getConfiguredTuiTheme,
  getConfiguredTuiThemeFollow,
  getConfiguredTuiTranscriptView,
  getConfiguredTuiTranscriptWidth,
  getConfiguredTuiVelocityScroll,
  getConfiguredTuiSurfacePanelPlacement,
  getConfiguredTuiWindowArrangement,
  setConfiguredTuiDensity,
  setConfiguredTuiDiffLayout,
  setConfiguredTuiFocusMode,
  setConfiguredTuiStickyHeaders,
  setConfiguredTuiLightweightWindows,
  setConfiguredTuiRailVisible,
  setConfiguredTuiSessionReaderState,
  setConfiguredTuiSidebarSort,
  getConfiguredTuiHideScratchSessions,
  setConfiguredTuiHideScratchSessions,
  getConfiguredTuiShowSettledSessions,
  setConfiguredTuiShowSettledSessions,
  setConfiguredTuiShowToolCalls,
  setConfiguredTuiSidebarWidth,
  setConfiguredTuiTabsEnabled,
  setConfiguredTuiTabOrientation,
  setConfiguredTuiSplitPanes,
  setConfiguredTuiSplitOrientation,
  setConfiguredTuiSplitReaderShare,
  setConfiguredTuiTheme,
  setConfiguredTuiThemeFollow,
  setConfiguredTuiThemeSync,
  setConfiguredTuiTranscriptView,
  setConfiguredTuiTranscriptWidth,
  setConfiguredTuiVelocityScroll,
  setConfiguredTuiSurfacePanelPlacement,
  setConfiguredTuiWindowArrangement,
  type TuiWindowArrangementState,
  type TuiSurfacePanelPlacement,
  type TuiSessionReaderState,
  type TuiThemeFollow,
  type TuiDiffLayout,
  type TuiSidebarSort,
  type TuiSplitOrientation,
  type TuiTranscriptWidth,
} from '../tuiState'
// Reads come from lib/sessionReads.ts directly: they route to adapters and
// touch no provider client, so they cost ~16MB rather than sessionBackend's ~72.
import {
  listViewSessionMessageWindow,
  listViewSessions,
  patchViewSession,
  readViewSessionDiagnostics,
  readViewSessionInfo,
  readViewSessionModels,
} from '../sessionReads'
// Pure parsing plus the live-turn registry read — neither reaches a provider
// client, so the Coordinator panel's state costs no send-path import.
import { extractPendingPermissions } from '../permissions'
import { listViewRunningSessions } from '../sessionActivity'
import { listWaitingSessions } from '../sessionRuntime'
import { coordinatorBackgroundAgents } from '../coordinatorInteractiveState'
import type { CoordinatorInteractiveState } from '../coordinatorInteractiveState'

// The send path is loaded on first use, not at import (load-bearing for
// memory). lib/sessionBackend.ts reaches every provider's client, harness and
// SDK; evaluating it is ~56MB of physical footprint on top of the read path.
// The TUI boots into a session list and a transcript — it can go a whole
// session without sending a turn — so paying that at startup was paying for
// work the user may never ask for. Every caller below is already async.
type SessionBackendModule = typeof import('../sessionBackend')
let loadedSessionBackend: SessionBackendModule | null = null
let sessionBackendLoad: Promise<SessionBackendModule> | null = null
function sendPath(): Promise<SessionBackendModule> {
  if (loadedSessionBackend) return Promise.resolve(loadedSessionBackend)
  sessionBackendLoad ??= import('../sessionBackend').then((mod) => {
    loadedSessionBackend = mod
    return mod
  })
  return sessionBackendLoad
}

// Same treatment, same reason: lib/agentCoordination.ts imports sessionBackend,
// so a static import here would drag the send path back in regardless.
type CoordinationModule = typeof import('../agentCoordination')
let loadedCoordination: CoordinationModule | null = null
let coordinationLoad: Promise<CoordinationModule> | null = null
function coordination(): Promise<CoordinationModule> {
  if (loadedCoordination) return Promise.resolve(loadedCoordination)
  coordinationLoad ??= import('../agentCoordination').then((mod) => {
    loadedCoordination = mod
    return mod
  })
  return coordinationLoad
}
// The read path lives in lib/tui/reads.ts, which imports no send-path module —
// the TUI's transcript Worker is a separate JS VM that only reads, and pulling
// this file's graph into it cost ~72MB against ~16MB. Re-exported so callers of
// service.ts are unaffected.
import {
  noteTuiSessionInstance,
  readTuiRunningSessions,
  readTuiRuntimeActivityState,
  readTuiSessionDetailSource,
  readTuiSessionMetadata,
  readTuiSessions,
  type TuiRuntimeActivity,
  type TuiSessionMetadata,
} from './reads'

export {
  readTuiComposerOptions,
  readTuiSessionDetailSource,
  readTuiSessionMetadata,
  readTuiSessions,
  readTuiSlashCommands,
  type TuiRuntimeActivity,
  type TuiSessionMetadata,
} from './reads'

import { dismissViewerAttention } from '../viewerAttention'
import {
  encodeSessionPath,
  isRemoteAttached,
  readDaemonStatus,
  providerQuery,
  remoteJson,
  remoteStream,
  subscribeRemoteProtocolRunChanges,
} from './remote'
import {
  getSessionBookmarkIds,
  listAllBookmarks,
  setMessageBookmark,
  type MessageBookmark,
  type SetMessageBookmarkInput,
} from '../messageBookmarks'
import type { PromptRecord, PromptSummary, SavePromptInput } from '../promptLibrary'
import {
  createWorktreeTask,
  findWorktreeTaskForCwd,
  findRepoRoot,
  listWorktreeTasks,
  mergeWorktreeTask,
  removeWorktreeTask,
  type WorktreeTask,
} from '../worktreeTasks'
import {
  changesSinceCheckpoint,
  commitAllChanges,
  createReviewPullRequest,
  deleteUntrackedFile,
  diffSinceCheckpoint,
  listTurnCheckpoints,
  listWorkingDiffHunks,
  readFileCheckpointHistory,
  rejectWorkingHunk,
  restoreCheckpoint,
  revertFileHistoryHunk,
  type CheckpointFileChange,
  type FileHistory,
  type FileHistoryStep,
  type TurnCheckpoint,
  type WorkingDiffHunk,
} from '../checkpoints'
import type { SelectionHistoryEntry } from '../selectionAsk'

import type { AgentProtocolEvent, PlaybookSummary, ProtocolRun, ProtocolRunSnapshot, RunPlaybook, StartProtocolRunParams, StartProtocolRunResult } from '../agentProtocol'
import type { AgentProvider, ContextUsage, ProviderSelection, Session, SessionDiagnosticSection, SessionInfo, SessionMessage, SessionModelInfo } from '../types'
import type { TuiDensity, TuiThemeMode, TuiTranscriptView } from '../../tui/theme'
import type { TuiTranscriptCard } from '../../tui/format'
import { hasSessionCoordinatorSync, openCoordinationLedgerReadOnly, readInteractiveAttentionReadOnly, type InteractiveAttentionSummary } from '../coordinatorLedger'
import {
  listAddressableSessions,
  sendCrossSessionMessage,
  type AddressableSession,
  type SendCrossSessionMessageResult,
} from '../crossSessionMessaging'


export type TuiSessionDetail = {
  /** Worker-computed retention estimate; avoids walking transcript payloads on the UI thread. */
  estimatedRetainedBytes?: number
  info: SessionInfo | null
  rawMessages: SessionMessage[]
  threadedMessages: ThreadedMessage[]
  // Worker-backed OpenTUI reads attach the cards they already paid to build.
  // Keeping that payload with the detail prevents a large transcript from
  // rendering empty when the worker client's side cache has been evicted.
  transcriptCards?: TuiTranscriptCard[]
  transcriptCardsDensity?: TuiDensity
  transcriptCardsShowToolCalls?: boolean
  contextUsage: ContextUsage | null
  // Codex only: another Codex client holds the rollout writer lock, so
  // rawMessages is a stale cached snapshot until that client's turn ends.
  externalWriter?: boolean
}


export async function readTuiCoordinatorCapabilities(sessionId: string, provider: AgentProvider, targetProvider: AgentProvider, providerInstanceId?: string) {
  if (isRemoteAttached()) return remoteJson<import('../coordinatorCapabilities').CoordinatorCapabilities>(`/api/sessions/${encodeURIComponent(sessionId)}/coordination?provider=${provider}&inspect=capabilities&targetProvider=${targetProvider}${providerInstanceId ? `&targetProviderInstanceId=${encodeURIComponent(providerInstanceId)}` : ''}`)
  const coord = await import('../agentCoordination')
  const snapshot = await coord.readSessionCoordinator(sessionId, provider)
  if (!snapshot) throw new Error('Enable Coordinator first')
  return (await import('../coordinatorCapabilities')).readCoordinatorCapabilities(targetProvider, snapshot.run.baseCwd, providerInstanceId ?? snapshot.agents.find(agent => agent.role === 'lead' && agent.provider === targetProvider)?.providerInstanceId)
}

export async function readTuiProvider(): Promise<ProviderSelection> {
  if (isRemoteAttached()) {
    const { provider } = await remoteJson<{ provider: ProviderSelection }>('/api/provider')
    return provider
  }
  return getConfiguredProvider()
}

/** `providerInstanceId` narrows the provider to one of its instances; without it the default is saved. */
export async function writeTuiProvider(provider: ProviderSelection, providerInstanceId?: string): Promise<void> {
  const target = { provider, ...(provider !== 'all' && providerInstanceId ? { providerInstanceId } : {}) }
  if (isRemoteAttached()) {
    await remoteJson('/api/provider', { method: 'PATCH', body: JSON.stringify(target) })
    return
  }
  await setConfiguredProviderTarget(target.providerInstanceId ? target : { provider, ...(provider === 'all' ? {} : { providerInstanceId: provider }) })
}

export type TuiProviderInstanceChoice = { provider: AgentProvider; providerInstanceId: string; label: string }

/**
 * The saved instance, when it is not the provider's default one, and every
 * further instance the provider menu can offer. A default instance is what the
 * bare provider row already means, so it is not listed; neither is an ACP agent
 * with no command.
 */
export async function readTuiProviderInstances(): Promise<{ selected: string | null; choices: TuiProviderInstanceChoice[] }> {
  if (isRemoteAttached()) {
    const state = await remoteJson<{ provider: ProviderSelection; providerInstanceId?: string; instances?: import('../types').ProviderInstanceSummary[] }>('/api/provider')
    return {
      selected: state.providerInstanceId && state.providerInstanceId !== state.provider ? state.providerInstanceId : null,
      choices: (state.instances ?? []).filter(instance => !instance.isDefault)
        .map(instance => ({ provider: instance.provider, providerInstanceId: instance.id, label: instance.displayName })),
    }
  }
  const [target, staffing] = await Promise.all([
    getConfiguredProviderTarget(),
    (await import('../coordinatorCapabilities')).readCoordinatorStaffing(),
  ])
  return {
    selected: target.providerInstanceId && target.providerInstanceId !== target.provider ? target.providerInstanceId : null,
    choices: staffing.filter(choice => !choice.isDefault).map(({ provider, providerInstanceId, label }) => ({ provider, providerInstanceId, label })),
  }
}

export async function listTuiAddressableSessions(excludeSessionId?: string): Promise<AddressableSession[]> {
  if (isRemoteAttached()) {
    const query = excludeSessionId ? `?exclude=${encodeURIComponent(excludeSessionId)}` : ''
    const result = await remoteJson<{ sessions: AddressableSession[] }>(`/api/agents${query}`)
    return result.sessions
  }
  return listAddressableSessions(excludeSessionId)
}

export async function sendTuiCrossSessionMessage(params: {
  fromSessionId?: string
  fromName: string
  toName: string
  text: string
}): Promise<SendCrossSessionMessageResult> {
  if (isRemoteAttached()) {
    return remoteJson<SendCrossSessionMessageResult>('/api/agents/message', {
      method: 'POST',
      body: JSON.stringify({
        fromSessionId: params.fromSessionId,
        fromName: params.fromName,
        to: params.toName,
        text: params.text,
      }),
    })
  }
  return sendCrossSessionMessage(params)
}

export async function readTuiTheme(): Promise<TuiThemeMode> {
  return getConfiguredTuiTheme()
}

export async function writeTuiTheme(theme: TuiThemeMode): Promise<void> {
  await setConfiguredTuiTheme(theme)
}

export function writeTuiThemeSync(theme: TuiThemeMode, followsTerminal?: boolean): void {
  setConfiguredTuiThemeSync(theme, followsTerminal)
}

export async function readTuiThemeFollow(): Promise<TuiThemeFollow> {
  return getConfiguredTuiThemeFollow()
}

export async function writeTuiThemeFollow(update: Partial<TuiThemeFollow>): Promise<void> {
  await setConfiguredTuiThemeFollow(update)
}

export async function readTuiRailVisible(): Promise<boolean> {
  return getConfiguredTuiRailVisible()
}

export async function writeTuiRailVisible(railVisible: boolean): Promise<void> {
  await setConfiguredTuiRailVisible(railVisible)
}

export async function readTuiSidebarWidth(): Promise<number> {
  return getConfiguredTuiSidebarWidth()
}

export async function writeTuiSidebarWidth(sidebarWidth: number): Promise<void> {
  await setConfiguredTuiSidebarWidth(sidebarWidth)
}

export async function readTuiFocusMode(): Promise<boolean> {
  return getConfiguredTuiFocusMode()
}

export async function writeTuiFocusMode(focusMode: boolean): Promise<void> {
  await setConfiguredTuiFocusMode(focusMode)
}

export async function readTuiStickyHeaders(): Promise<boolean> {
  return getConfiguredTuiStickyHeaders()
}

export async function writeTuiStickyHeaders(stickyHeaders: boolean): Promise<void> {
  await setConfiguredTuiStickyHeaders(stickyHeaders)
}

export async function readTuiLightweightWindows(): Promise<boolean> {
  return getConfiguredTuiLightweightWindows()
}

export async function writeTuiLightweightWindows(lightweightWindows: boolean): Promise<void> {
  await setConfiguredTuiLightweightWindows(lightweightWindows)
}

export async function readTuiDensity(): Promise<TuiDensity> {
  return getConfiguredTuiDensity()
}

export async function writeTuiDensity(density: TuiDensity): Promise<void> {
  await setConfiguredTuiDensity(density)
}

export async function readTuiDiffLayout(): Promise<TuiDiffLayout> {
  return getConfiguredTuiDiffLayout()
}

export async function writeTuiDiffLayout(diffLayout: TuiDiffLayout): Promise<void> {
  await setConfiguredTuiDiffLayout(diffLayout)
}

export async function readTuiTranscriptView(): Promise<TuiTranscriptView> {
  return getConfiguredTuiTranscriptView()
}

export async function writeTuiTranscriptView(transcriptView: TuiTranscriptView): Promise<void> {
  await setConfiguredTuiTranscriptView(transcriptView)
}

export async function readTuiTranscriptWidth(): Promise<TuiTranscriptWidth> {
  return getConfiguredTuiTranscriptWidth()
}

export async function writeTuiTranscriptWidth(transcriptWidth: TuiTranscriptWidth): Promise<void> {
  await setConfiguredTuiTranscriptWidth(transcriptWidth)
}

export async function readTuiTabOrientation() {
  return getConfiguredTuiTabOrientation()
}

export async function writeTuiTabOrientation(orientation: 'horizontal' | 'vertical'): Promise<void> {
  await setConfiguredTuiTabOrientation(orientation)
}

export async function readTuiTabsEnabled(): Promise<boolean> {
  return getConfiguredTuiTabsEnabled()
}

export async function writeTuiTabsEnabled(tabsEnabled: boolean): Promise<void> {
  await setConfiguredTuiTabsEnabled(tabsEnabled)
}

export async function readTuiSplitPanes(): Promise<number> {
  return getConfiguredTuiSplitPanes()
}

export async function writeTuiSplitPanes(splitPanes: number): Promise<void> {
  await setConfiguredTuiSplitPanes(splitPanes)
}

export async function readTuiSplitOrientation(): Promise<TuiSplitOrientation> {
  return getConfiguredTuiSplitOrientation()
}

export async function writeTuiSplitOrientation(orientation: TuiSplitOrientation): Promise<void> {
  await setConfiguredTuiSplitOrientation(orientation)
}

export async function readTuiSplitReaderShare(): Promise<number> {
  return getConfiguredTuiSplitReaderShare()
}

export async function writeTuiSplitReaderShare(share: number): Promise<void> {
  await setConfiguredTuiSplitReaderShare(share)
}

export async function readTuiShowToolCalls(): Promise<boolean> {
  return getConfiguredTuiShowToolCalls()
}

export async function writeTuiShowToolCalls(showToolCalls: boolean): Promise<void> {
  await setConfiguredTuiShowToolCalls(showToolCalls)
}

export async function readTuiVelocityScroll(): Promise<boolean> {
  return getConfiguredTuiVelocityScroll()
}

export async function writeTuiVelocityScroll(velocityScroll: boolean): Promise<void> {
  await setConfiguredTuiVelocityScroll(velocityScroll)
}

export async function readTuiSurfacePanelPlacement(): Promise<TuiSurfacePanelPlacement> {
  return getConfiguredTuiSurfacePanelPlacement()
}

export async function writeTuiSurfacePanelPlacement(placement: TuiSurfacePanelPlacement): Promise<void> {
  await setConfiguredTuiSurfacePanelPlacement(placement)
}

export async function readTuiWindowArrangement(): Promise<TuiWindowArrangementState> {
  return getConfiguredTuiWindowArrangement()
}

export async function writeTuiWindowArrangement(state: TuiWindowArrangementState): Promise<void> {
  await setConfiguredTuiWindowArrangement(state)
}

export async function readTuiSidebarSort(): Promise<TuiSidebarSort> {
  return getConfiguredTuiSidebarSort()
}

export async function writeTuiSidebarSort(sidebarSort: TuiSidebarSort): Promise<void> {
  await setConfiguredTuiSidebarSort(sidebarSort)
}

export async function readTuiHideScratchSessions(): Promise<boolean> {
  return getConfiguredTuiHideScratchSessions()
}

export async function writeTuiHideScratchSessions(hide: boolean): Promise<void> {
  await setConfiguredTuiHideScratchSessions(hide)
}

export async function readTuiShowSettledSessions(): Promise<boolean> {
  return getConfiguredTuiShowSettledSessions()
}

export async function writeTuiShowSettledSessions(show: boolean): Promise<void> {
  await setConfiguredTuiShowSettledSessions(show)
}

/**
 * Settle a session (done: out of the resting list) or reopen it — the web
 * rail's ✓/↺, through the same store, so either surface sees the other's.
 */
export async function updateTuiSessionInbox(
  session: Pick<Session, 'sessionId' | 'provider' | 'providerInstanceId'>,
  action: 'settle' | 'reopen',
): Promise<SessionInboxState> {
  const provider = session.provider ?? 'claude'
  if (isRemoteAttached()) {
    const result = await remoteJson<{ inbox: SessionInboxState }>(encodeSessionPath(session.sessionId, '/inbox'), {
      method: 'POST',
      body: JSON.stringify({ provider, action, ...(session.providerInstanceId ? { providerInstanceId: session.providerInstanceId } : {}) }),
    })
    return result.inbox
  }
  return updateSessionInboxState({ provider, sessionId: session.sessionId, providerInstanceId: session.providerInstanceId, action })
}

export type { TuiDiffLayout, TuiSidebarSort, TuiTranscriptWidth }

export async function readTuiSessionReaderState(sessionKey: string): Promise<TuiSessionReaderState | null> {
  return getConfiguredTuiSessionReaderState(sessionKey)
}

export async function writeTuiSessionReaderState(
  sessionKey: string,
  sessionReaderState: TuiSessionReaderState,
): Promise<void> {
  await setConfiguredTuiSessionReaderState(sessionKey, sessionReaderState)
}


const THREADING_CACHE_LIMIT = 3
const threadingCacheByKey = new Map<string, IncrementalThreadingCache>()

function threadingCacheKey(session: Session): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

function touchThreadingCache(key: string, cache: IncrementalThreadingCache): void {
  if (threadingCacheByKey.has(key)) threadingCacheByKey.delete(key)
  threadingCacheByKey.set(key, cache)
  while (threadingCacheByKey.size > THREADING_CACHE_LIMIT) {
    const oldestKey = threadingCacheByKey.keys().next().value
    if (oldestKey === undefined) break
    threadingCacheByKey.delete(oldestKey)
  }
}

function threadMessages(session: Session, messages: SessionMessage[]): ThreadedMessage[] {
  const key = threadingCacheKey(session)
  const cached = threadingCacheByKey.get(key)
  let threaded: ThreadedMessage[] | null = null
  if (cached) threaded = buildThreadedMessagesIncremental(messages, cached)
  const nextThreaded = threaded ?? buildThreadedMessages(messages)
  touchThreadingCache(key, { messages, threaded: nextThreaded })
  return nextThreaded
}

export async function readTuiSessionDetail(session: Session): Promise<TuiSessionDetail> {
  const { info, rawMessages, externalWriter } = await readTuiSessionDetailSource(session)

  return {
    info,
    rawMessages,
    threadedMessages: threadMessages(session, rawMessages),
    contextUsage: null,
    externalWriter,
  }
}


/**
 * Runs a send-path call as the instance the session belongs to. The read path
 * does this for itself (lib/sessionReads.ts); the send path is still a provider
 * switch, so the TUI scopes it here, where it has the session in hand.
 */
async function asSessionInstance<T>(
  session: { sessionId: string; provider?: AgentProvider; providerInstanceId?: string },
  run: () => Promise<T>,
): Promise<T> {
  if (!session.provider) return run()
  noteTuiSessionInstance(session)
  if (session.providerInstanceId) {
    const { withProviderInstance } = await import('../providerInstances')
    return withProviderInstance(session.providerInstanceId, session.provider, run)
  }
  return withSessionInstance(session.provider, session.sessionId, run)
}

export async function patchTuiSession(session: Session, body: Record<string, unknown>): Promise<void> {
  if (isRemoteAttached()) {
    await remoteJson(encodeSessionPath(session.sessionId), {
      method: 'PATCH',
      body: JSON.stringify({ ...body, provider: session.provider }),
    })
    return
  }
  return patchViewSession(session.sessionId, body, session.provider)
}

export async function streamTuiSessionTurn(
  session: Session,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  if (isRemoteAttached()) {
    // The daemon runs the turn; this Response is just the SSE view of it. The
    // turn survives this TUI aborting/dying — the reattach poll picks it up.
    return remoteStream(encodeSessionPath(session.sessionId, '/messages'), {
      ...body,
      provider: session.provider,
    }, signal)
  }
  return asSessionInstance(session, async () => (await coordination()).withCooperativeInbox(session.sessionId, body, async outgoing =>
    (await sendPath()).streamViewSessionTurn({
      sessionId: session.sessionId,
      signal: signal ?? new AbortController().signal,
      body: outgoing,
      provider: session.provider as AgentProvider | undefined,
    })))
}

/**
 * Interrupt the session's running turn. Resolves to the uuids of queued async
 * messages that survive the interrupt (Claude interrupt_receipt_v1), when the
 * provider reports them.
 */
export async function interruptTuiSessionTurn(session: { sessionId: string; provider?: AgentProvider; providerInstanceId?: string; turnRequestId?: string }): Promise<string[] | undefined> {
  if (isRemoteAttached()) {
    const response = await remoteJson<{ stillQueued?: unknown }>(encodeSessionPath(session.sessionId, '/interrupt'), {
      method: 'POST',
      body: JSON.stringify({
        provider: session.provider,
        providerInstanceId: session.providerInstanceId,
        turnRequestId: session.turnRequestId,
        cancelQueued: true,
      }),
    })
    return Array.isArray(response?.stillQueued)
      ? response.stillQueued.filter((uuid): uuid is string => typeof uuid === 'string')
      : undefined
  }
  return asSessionInstance(session, async () => (await sendPath()).interruptViewSession(session.sessionId, session.turnRequestId, true))
}

/**
 * Snapshot of every session with a turn running in this process, including
 * provider-native approvals/questions the turn is blocked on. The TUI and its
 * backend share one process, so this registry read is synchronous and
 * authoritative for live-turn reattach and cross-session attention.
 */
export async function listTuiRunningSessions(): Promise<Awaited<ReturnType<typeof readTuiRunningSessions>>> {
  return readTuiRunningSessions()
}

/**
 * Whether the daemon this TUI is attached to can serve it, or null when it can
 * (and when running in-process, where there is no daemon to mismatch).
 */
/** What turning this team off would leave behind; see readInteractiveTeardown. */
/**
 * Every interactive conversation whose team has something for the user, for
 * the session list's marks. Read from the ledger alone (lib/coordinatorLedger.ts)
 * rather than through coordination(): this runs on a poll from boot, and loading
 * the send path to answer it would cost a browse-only session its footprint.
 */
export async function readTuiInteractiveAttention(): Promise<InteractiveAttentionSummary[]> {
  if (isRemoteAttached()) {
    const { attention } = await remoteJson<{ attention: InteractiveAttentionSummary[] }>('/api/agent-protocol/attention')
    return attention ?? []
  }
  const db = await openCoordinationLedgerReadOnly()
  return db ? readInteractiveAttentionReadOnly(db) : []
}

/**
 * Whether a conversation has a Coordinator team, from the read-only ledger.
 * Observing a conversation's Coordinator loads lib/agentCoordination.ts — and
 * through it the whole send path — so a surface that observes the selected
 * conversation asks this first; most conversations have no team. Attached to a
 * daemon the observation is an HTTP read, so the answer is simply yes.
 */
export async function readTuiHasSessionCoordinator(sessionId: string, provider: AgentProvider): Promise<boolean> {
  if (isRemoteAttached()) return true
  const db = await openCoordinationLedgerReadOnly()
  if (!db) return false
  try {
    return hasSessionCoordinatorSync(db, sessionId, provider)
  } catch {
    // An unreadable ledger must not hide a team; observe as before.
    return true
  }
}

export async function readTuiInteractiveTeardown(sessionId: string, provider: AgentProvider): Promise<{
  worktrees: Array<{ agentName: string; branch: string; path: string; changedFiles: number }>
  runningTurns: string[]
}> {
  if (isRemoteAttached()) {
    return remoteJson(`${encodeSessionPath(sessionId, '/coordination/teardown')}${providerQuery(provider)}`)
  }
  const coord = await coordination()
  return coord.readInteractiveTeardown(sessionId, provider)
}

export async function readTuiDaemonWarning(): Promise<string | null> {
  if (!isRemoteAttached()) return null
  const { daemonCompatibilityWarning } = await import('../daemonProtocol')
  return daemonCompatibilityWarning(await readDaemonStatus())
}

export async function readTuiRuntimeActivity(): Promise<TuiRuntimeActivity> {
  return readTuiRuntimeActivityState()
}

export async function dismissTuiViewerAttention(attentionId: string): Promise<boolean> {
  if (isRemoteAttached()) {
    const result = await remoteJson<{ dismissed: boolean }>('/api/sessions/running', {
      method: 'DELETE',
      body: JSON.stringify({ attentionId }),
    })
    return result.dismissed
  }
  return dismissViewerAttention(attentionId)
}

// Worktree-per-task orchestration: isolate an agent task in its own git
// worktree + branch, then squash-merge the result back or discard it.
export async function createTuiWorktreeTask(cwd: string, name: string): Promise<WorktreeTask> {
  return createWorktreeTask(cwd, name)
}

export async function findTuiWorktreeTask(cwd: string): Promise<WorktreeTask | null> {
  return findWorktreeTaskForCwd(cwd)
}

export async function listTuiWorktreeTasks(cwd: string): Promise<WorktreeTask[]> {
  return listWorktreeTasks(cwd)
}

export async function mergeTuiWorktreeTask(task: WorktreeTask): Promise<{ staged: boolean }> {
  const validation = await (await coordination()).validateWorktreeTaskLocks(task)
  if (!validation.ok) throw new Error(validation.message)
  return mergeWorktreeTask(task)
}

export async function removeTuiWorktreeTask(task: WorktreeTask, opts?: { force?: boolean }): Promise<void> {
  return removeWorktreeTask(task, opts)
}

export type { WorktreeTask }

// Turn checkpoints + change review (lib/checkpoints.ts): every turn snapshots
// the working tree first; these expose list/diff/restore and the per-hunk
// review → commit → PR flow to the TUI.
export async function listTuiCheckpoints(cwd: string): Promise<TurnCheckpoint[]> {
  return listTurnCheckpoints(cwd)
}

export async function readTuiCheckpointChanges(cwd: string, sha: string): Promise<CheckpointFileChange[]> {
  return changesSinceCheckpoint(cwd, sha)
}

/**
 * Claude plan rate-limit windows for the composer's limit meter, read through
 * the session's warm entry (never a spawn). Attached, the turns run in the
 * daemon and there is no local entry to ask, so there is no meter.
 */
export async function readTuiClaudePlanLimits(session: Pick<Session, 'sessionId' | 'provider' | 'providerInstanceId'>): Promise<ClaudePlanLimits | null> {
  if (isRemoteAttached() || session.provider !== 'claude') return null
  return readClaudePlanLimits(session.sessionId, session.providerInstanceId ?? 'default')
}

export function peekTuiClaudePlanLimits(session: Pick<Session, 'provider' | 'providerInstanceId'>): ClaudePlanLimits | null {
  if (session.provider !== 'claude') return null
  return peekClaudePlanLimits(session.providerInstanceId ?? 'default')
}

export async function readTuiCheckpointDiff(cwd: string, sha: string, filePath?: string, untilSha?: string): Promise<string> {
  return diffSinceCheckpoint(cwd, sha, filePath, untilSha)
}

export async function restoreTuiCheckpoint(
  cwd: string,
  sha: string,
  paths?: string[],
  context?: { sessionId?: string; provider?: string; providerInstanceId?: string },
): Promise<{ restored: number; deleted: number }> {
  const result = await restoreCheckpoint(cwd, sha, paths)
  if (context?.sessionId && isAgentProvider(context.provider) && getProviderManifest(context.provider).fileRestoreHook) {
    const provider = context.provider
    const sessionId = context.sessionId
    const { currentProviderInstanceId, withProviderInstance } = await import('../providerInstances')
    const run = async () => {
      const runtime = await (await import('../extensions/providers/registry')).getProviderRuntime(provider)
      await runtime.afterFileRestore?.({ sessionId, cwd, paths, provider, providerInstanceId: currentProviderInstanceId(provider) })
    }
    if (context.providerInstanceId) await withProviderInstance(context.providerInstanceId, provider, run)
    else await withSessionInstance(provider, sessionId, run)
  }
  return result
}

export async function listTuiWorkingDiff(cwd: string): Promise<{ hunks: WorkingDiffHunk[]; untracked: string[] }> {
  return listWorkingDiffHunks(cwd)
}

export async function rejectTuiWorkingHunk(cwd: string, patchText: string): Promise<void> {
  return rejectWorkingHunk(cwd, patchText)
}

export async function deleteTuiUntrackedFile(cwd: string, relPath: string): Promise<void> {
  return deleteUntrackedFile(cwd, relPath)
}

export async function commitTuiAllChanges(cwd: string, message: string): Promise<string> {
  return commitAllChanges(cwd, message)
}

export async function createTuiReviewPullRequest(cwd: string, title: string): Promise<string> {
  return createReviewPullRequest(cwd, title)
}

export async function readTuiFileHistory(cwd: string, filePath: string): Promise<FileHistory> {
  return readFileCheckpointHistory(cwd, filePath)
}

export async function revertTuiFileHistoryHunk(repoRoot: string, patchText: string): Promise<void> {
  return revertFileHistoryHunk(repoRoot, patchText)
}

/**
 * Who wrote lines `startLine`..`endLine` (1-based) of a file: the recorded agent
 * turns from the provenance index, then commits for lines no turn accounts for.
 * Attribution is against the file on disk, so an editor holding unsaved edits
 * may be a few lines off — the prompt says the selection includes them.
 * Loaded on demand: provenance opens the search index, which a session that
 * never asks "why" should not pay for.
 */
export async function readTuiLineHistory(cwd: string, filePath: string, startLine: number, endLine: number): Promise<SelectionHistoryEntry[]> {
  const [{ blameFileProvenance }, { promises: fs }, path] = await Promise.all([import('../provenance'), import('node:fs'), import('node:path')])
  // An editor path is relative to the editor's root; a diff's is relative to
  // the repository's. They differ when the TUI runs in a subdirectory.
  let base = cwd
  if (!path.isAbsolute(filePath) && !(await fs.stat(path.resolve(cwd, filePath)).catch(() => null))) {
    base = (await findRepoRoot(cwd)) ?? cwd
  }
  const blame = await blameFileProvenance({ file: filePath, cwd: base })
  const first = startLine - 1
  const last = endLine - 1
  const entries: SelectionHistoryEntry[] = []
  const covered = new Set<number>()
  for (const segment of blame.segments) {
    if (segment.end < first || segment.start > last) continue
    const start = Math.max(segment.start, first)
    const end = Math.min(segment.end, last)
    for (let line = start; line <= end; line += 1) covered.add(line)
    const title = segment.edit.sessionTitle ? ` "${segment.edit.sessionTitle}"` : ''
    entries.push({
      startLine: start + 1,
      endLine: end + 1,
      source: `${segment.edit.provider} session ${segment.edit.sessionId.slice(0, 8)}${title}`,
      text: segment.edit.prompt,
      timestampMs: segment.edit.timestampMs,
    })
  }
  for (const segment of blame.commitSegments) {
    if (segment.end < first || segment.start > last) continue
    const start = Math.max(segment.start, first)
    const end = Math.min(segment.end, last)
    let uncovered = false
    for (let line = start; line <= end && !uncovered; line += 1) uncovered = !covered.has(line)
    if (!uncovered) continue
    entries.push({
      startLine: start + 1,
      endLine: end + 1,
      source: `commit ${segment.sha.slice(0, 8)}${segment.author ? ` by ${segment.author}` : ''}`,
      text: segment.summary,
      timestampMs: segment.authorTime,
    })
  }
  return entries.sort((a, b) => (a.startLine ?? 0) - (b.startLine ?? 0))
}

export type { TurnCheckpoint, CheckpointFileChange, WorkingDiffHunk, FileHistory, FileHistoryStep }

/**
 * What every agent did over a day or a week, grouped by repository. Loaded on
 * demand: it opens the search index and spawns git and `gh` per repository,
 * which nothing on the browse path should pay for.
 */
export async function readTuiDailySummary(options: import('../dailySummaryReader').DailySummaryReadOptions): Promise<import('../dailySummary').DailySummary> {
  const { readDailySummary } = await import('../dailySummaryReader')
  return readDailySummary(options)
}

export async function startTuiProtocolRun(params: StartProtocolRunParams): Promise<StartProtocolRunResult> {
  if (isRemoteAttached()) {
    return remoteJson('/api/agent-protocol/runs', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }
  return (await coordination()).startProtocolRun(params)
}

export async function listTuiRunPlaybooks(cwd: string): Promise<{ playbooks: PlaybookSummary[]; invalid: Array<{ file: string; error: string }> }> {
  if (isRemoteAttached()) {
    const query = new URLSearchParams({ cwd }).toString()
    return remoteJson(`/api/agent-protocol/playbooks?${query}`)
  }
  return (await coordination()).listRunPlaybooks(cwd)
}

export async function previewTuiInteractiveWorkflow(cwd: string, name: string, provider: AgentProvider, args?: unknown): Promise<import('../agentCoordination').InteractiveWorkflowPreview> {
  if (isRemoteAttached()) {
    const query = new URLSearchParams({ cwd, name, provider, preview: 'interactive' })
    if (args !== undefined) query.set('args', JSON.stringify(args))
    return remoteJson(`/api/agent-protocol/playbooks?${query}`)
  }
  return (await coordination()).previewInteractiveWorkflow({ cwd, name, provider, args })
}

export async function readTuiRunPlaybook(cwd: string, name: string): Promise<RunPlaybook> {
  if (isRemoteAttached()) {
    const query = new URLSearchParams({ cwd, name }).toString()
    const result = await remoteJson<{ playbook: RunPlaybook }>(`/api/agent-protocol/playbooks?${query}`)
    return result.playbook
  }
  return (await coordination()).loadRunPlaybook(cwd, name)
}

export async function writeTuiRunPlaybook(cwd: string, playbook: unknown, previousName?: string): Promise<{ playbook: RunPlaybook; path: string }> {
  if (isRemoteAttached()) {
    return remoteJson('/api/agent-protocol/playbooks', {
      method: 'PUT',
      body: JSON.stringify({ cwd, playbook, previousName }),
    })
  }
  return (await coordination()).writeRunPlaybook(cwd, playbook, previousName)
}

export async function deleteTuiRunPlaybook(cwd: string, name: string): Promise<void> {
  if (isRemoteAttached()) {
    await remoteJson('/api/agent-protocol/playbooks', {
      method: 'DELETE',
      body: JSON.stringify({ cwd, name }),
    })
    return
  }
  await (await coordination()).deleteRunPlaybook(cwd, name)
}

export async function readTuiProtocolRun(runId: string): Promise<ProtocolRunSnapshot | null> {
  if (isRemoteAttached()) {
    return remoteJson(`/api/agent-protocol/runs/${encodeURIComponent(runId)}`)
  }
  return (await coordination()).readProtocolRun(runId)
}

export async function listTuiProtocolRuns(limit?: number): Promise<ProtocolRun[]> {
  if (isRemoteAttached()) {
    const query = limit === undefined ? '' : `?limit=${encodeURIComponent(String(limit))}`
    const { runs } = await remoteJson<{ runs: ProtocolRun[] }>(`/api/agent-protocol/runs${query}`)
    return runs
  }
  return (await coordination()).listProtocolRuns(limit)
}

/** Subscribe to Coordinator changes locally or through the attached daemon. */
export function subscribeTuiProtocolRunChanges(listener: (runId: string | null) => void): (() => void) | null {
  if (isRemoteAttached()) {
    return subscribeRemoteProtocolRunChanges(listener, () => listener(null))
  }
  // Synchronous by contract — callers get an unsubscribe back immediately — so
  // it cannot await the coordinator module. Subscribe once it resolves, and let
  // an unsubscribe that arrives first cancel the pending subscription.
  let dispose: (() => void) | null = null
  let cancelled = false
  void coordination().then(({ subscribeProtocolRunChanges }) => {
    if (cancelled) return
    dispose = subscribeProtocolRunChanges(listener)
  })
  return () => {
    cancelled = true
    dispose?.()
    dispose = null
  }
}

export async function stopTuiProtocolRun(runId: string): Promise<ProtocolRunSnapshot | null> {
  if (isRemoteAttached()) {
    return remoteJson(`/api/agent-protocol/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' })
  }
  return (await coordination()).stopProtocolRun(runId)
}

export async function cleanupTuiProtocolRunWorktrees(runId: string, opts?: { force?: boolean }): Promise<Awaited<ReturnType<CoordinationModule['cleanupProtocolRunWorktrees']>>> {
  if (isRemoteAttached()) {
    return remoteJson(`/api/agent-protocol/runs/${encodeURIComponent(runId)}/cleanup`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    })
  }
  return (await coordination()).cleanupProtocolRunWorktrees(runId, opts)
}

export async function deleteTuiProtocolRun(runId: string): Promise<{ deleted: boolean; keptWorktrees: string[] }> {
  if (isRemoteAttached()) {
    return remoteJson(`/api/agent-protocol/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' })
  }
  return (await coordination()).deleteProtocolRun(runId)
}

export async function appendTuiProtocolEvent(event: AgentProtocolEvent): Promise<ProtocolRunSnapshot | null> {
  if (isRemoteAttached()) {
    return remoteJson(`/api/agent-protocol/runs/${encodeURIComponent(event.runId)}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    })
  }
  return (await coordination()).appendProtocolEvent(event)
}

/**
 * The interactive Coordinator state for one conversation: its run snapshot,
 * the durable interactive settings, which teammates are mid-turn, which need
 * recovery, and any provider-native approval waiting on the human.
 *
 * Deliberately assembled from `lib/sessionActivity.ts` rather than
 * `readViewSessionRunning`: that lives in `lib/sessionBackend.ts`, and reading
 * it here would pull the whole send path in behind a surface the user may only
 * ever look at. The coordination module below loads it anyway — but only once
 * the panel is actually opened, not from a poll.
 */
export async function readTuiSessionCoordinator(
  sessionId: string,
  provider: AgentProvider,
): Promise<CoordinatorInteractiveState> {
  if (isRemoteAttached()) {
    return remoteJson(`${encodeSessionPath(sessionId, '/coordination')}${providerQuery(provider)}`)
  }
  const coord = await coordination()
  await coord.adoptOrphanedInteractiveHost(sessionId, provider).catch(() => {})
  const snapshot = await coord.readSessionCoordinator(sessionId, provider)
  const interactive = await coord.readInteractiveCoordinator(sessionId)
  const recoveries = snapshot ? await coord.readInteractiveRecoveries(snapshot.run.id) : []
  const settledExecutions = snapshot ? await coord.readSettledInteractiveExecutions(snapshot.run.id) : []
  const deadAgents = snapshot ? await coord.readInteractiveDeadAgents(snapshot.run.id) : []
  const running = new Map(listViewRunningSessions().map((entry) => [entry.sessionId, entry]))
  const runningAgentIds: string[] = []
  const permissions = snapshot?.agents.flatMap((agent) => {
    const info = running.get(agent.sessionId)
    if (!info) return []
    runningAgentIds.push(agent.id)
    return extractPendingPermissions(info.pendingPermissions, { sessionId: agent.sessionId, provider: agent.provider })
      .map((permission) => ({ agentId: agent.id, agentName: agent.name, permission }))
  }) ?? []
  const backgroundAgents = snapshot ? coordinatorBackgroundAgents(snapshot.agents, listWaitingSessions()) : []
  const staffing = await (await import('../coordinatorCapabilities')).readCoordinatorStaffing()
  return { snapshot, interactive, recoveries, settledExecutions, deadAgents, permissions, runningAgentIds, backgroundAgents, staffing }
}

export async function inspectTuiCoordinatorRecovery(sessionId: string, provider: AgentProvider): Promise<import('../coordinatorRecovery').RecoveryInspection | null> {
  if (isRemoteAttached()) {
    const response = await remoteJson<{ inspection: import('../coordinatorRecovery').RecoveryInspection | null }>(`${encodeSessionPath(sessionId, '/coordination')}${providerQuery(provider)}&inspect=recovery`)
    return response.inspection
  }
  const snapshot = await (await coordination()).readSessionCoordinator(sessionId, provider)
  return snapshot ? (await import('../coordinatorRecoveryServer')).inspectCoordinatorRecovery(snapshot) : null
}

export type TuiSessionCoordinationRequest = import('../coordinatorNativePermission').CoordinatorNativeAnswer & {
  providerInstanceId?: string
  token?: string
  action: 'native-answer' | 'start-workflow' | 'integrate-result' | 'disable' | 'enable' | 'settings' | 'reconcile' | 'resume-agent' | 'reconcile-agent' | 'interrupt-agent' | 'cancel-task' | 'delegate' | 'message' | 'review-plan' | 'decision'
  /** Provider for a NEW teammate; an existing one keeps its own. */
  teammateProvider?: AgentProvider
  /** Name for a NEW teammate (herdr's `agent start <name>`). */
  teammateName?: string
  requestedProviderInstanceId?: string
  requestedModel?: string
  requestedEffort?: string
  playbook?: RunPlaybook
  workflowArgs?: unknown
  /** Stable across retries: every mutation below is replayed under this key. */
  requestId: string
  detail: string
  cwd?: string
  maxAgents?: number
  budget?: import('../agentProtocol').ProtocolRunBudget | null
  autoContinue?: boolean
  autoResume?: boolean
  useWorktrees?: boolean
  batchId?: string
  received?: boolean
  to?: string
  paths?: string[]
  taskId?: string
  decisionId?: string
  approved?: boolean
  inReplyTo?: string
  expectedRunId?: string
  expectedAgent?: { id: string; sessionId: string; provider: AgentProvider }
}

/**
 * Run one Coordinator action for this conversation and return the state that
 * followed it. `requestId` is the idempotency key the caller must reuse
 * verbatim when a request's outcome is unknown — a retry with the same key
 * reconciles rather than repeating the mutation.
 */
export async function sendTuiSessionCoordination(sessionId: string, provider: AgentProvider, request: TuiSessionCoordinationRequest): Promise<CoordinatorInteractiveState> {
  const { withProviderInstance } = await import('../providerInstances')
  return withProviderInstance(request.providerInstanceId, provider, () => sendTuiSessionCoordinationScoped(sessionId, provider, request))
}

async function sendTuiSessionCoordinationScoped(
  sessionId: string,
  provider: AgentProvider,
  request: TuiSessionCoordinationRequest,
): Promise<CoordinatorInteractiveState> {
  if (isRemoteAttached()) {
    const response = await remoteJson<CoordinatorInteractiveState & { result?: { warnings?: string[] } }>(encodeSessionPath(sessionId, '/coordination'), {
      method: 'POST',
      body: JSON.stringify({ provider, ...request }),
    })
    if (response.result?.warnings?.length) throw new Error(`Workflow saved; ${response.result.warnings.join('; ')}. Retry the same request to reconcile staffing.`)
    return response
  }
  const coord = await coordination()
  if (request.expectedRunId) {
    const snapshot = await coord.readSessionCoordinator(sessionId, provider)
    if (snapshot?.run.id !== request.expectedRunId) throw new Error('Coordinator team changed; refresh before sending to this conversation')
    if (request.expectedAgent && !snapshot.agents.some(agent => agent.id === request.expectedAgent!.id && agent.sessionId === request.expectedAgent!.sessionId && agent.provider === request.expectedAgent!.provider)) {
      throw new Error('Teammate identity changed; refresh before sending')
    }
  }
  if (request.action === 'native-answer') {
    if (!request.expectedRunId) throw new Error('Bind the team before answering a native request')
    if (await coord.readCoordinatorNativeAnswerReceipt(sessionId, provider, request.expectedRunId, request.requestId)) return readTuiSessionCoordinator(sessionId, provider)
  }
  if (request.action === 'integrate-result') {
    if (!request.taskId || !request.token) throw new Error('Review the result before integrating')
    await (await import('../coordinatorResultReviewServer')).integrateCoordinatorResult(sessionId, provider, request.taskId, request.token, request.requestId)
    return readTuiSessionCoordinator(sessionId, provider)
  }
  if (request.action === 'disable' || request.action === 'enable') {
    const info = request.action === 'enable' ? await readViewSessionInfo(sessionId, provider).catch(() => null) : null
    await coord.setInteractiveCoordinatorEnabled({ sessionId, provider, requestId: request.requestId, enabled: request.action === 'enable', cwd: info?.cwd || request.cwd, autoContinue: request.autoContinue })
    return readTuiSessionCoordinator(sessionId, provider)
  }
  if (request.action === 'start-workflow' || request.action === 'delegate' || request.action === 'settings') {
    const cwd = (await readViewSessionInfo(sessionId, provider).catch(() => null))?.cwd || request.cwd
    if (!cwd) throw new Error('Open a local project conversation before delegating')
    await coord.configureInteractiveCoordinator({ sessionId, provider, cwd })
  }
  const identity = await coord.sessionCoordinatorIdentity(sessionId, provider, request.expectedRunId)
  if (request.action === 'start-workflow') {
    const result = await coord.startInteractiveWorkflow(identity, { requestId: request.requestId, playbook: request.playbook, args: request.workflowArgs })
    if (result.warnings.length) throw new Error(`Workflow saved; ${result.warnings.join('; ')}. Retry the same request to reconcile staffing.`)
    return readTuiSessionCoordinator(sessionId, provider)
  }
  await coord.runExternalProtocolIdempotent(identity, `chat_${request.action}`, request.requestId, async () => {
    if (request.action === 'native-answer') {
      if (!request.expectedRunId) throw new Error('Bind the team before answering a native request')
      return (await import('../coordinatorNativePermissionServer')).answerCoordinatorNativePermission(identity, request)
    }
    if (request.action === 'settings') {
      const snapshot = await coord.readSessionCoordinator(sessionId, provider)
      await coord.configureInteractiveCoordinator({
        sessionId, provider, cwd: snapshot!.run.baseCwd, autoContinue: request.autoContinue, autoResume: request.autoResume,
        useWorktrees: request.useWorktrees, maxAgents: request.maxAgents, budget: request.budget,
      })
      return { configured: true }
    }
    if (request.action === 'reconcile') {
      if (!request.batchId || request.received === undefined) throw new Error('Select the delivery batch and its observed outcome')
      await coord.reconcileInteractiveDelivery(sessionId, request.batchId, request.received)
      return { reconciled: true }
    }
    if (request.action === 'interrupt-agent') {
      if (!request.to) throw new Error('Choose the teammate to interrupt')
      await coord.interruptInteractiveAgent(identity, request.to)
      return { interrupted: true }
    }
    if (request.action === 'cancel-task') {
      if (!request.taskId) throw new Error('Choose the task to cancel')
      return coord.cancelInteractiveTask(identity, request.taskId, request.detail)
    }
    if (request.action === 'reconcile-agent') {
      if (!request.to) throw new Error('Choose the settled teammate execution')
      await coord.reconcileSettledInteractiveExecution(identity, request.to)
      return { acknowledged: true }
    }
    if (request.action === 'resume-agent') {
      if (!request.to) throw new Error('Choose the teammate to resume')
      await coord.resumeInteractiveAgent(identity, request.to)
      return { resumed: true }
    }
    if (request.action === 'delegate') {
      return coord.createExternalProtocolTask(identity, {
        requestedProvider: request.teammateProvider,
        requestedProviderInstanceId: request.requestedProviderInstanceId,
        requestedModel: request.requestedModel, requestedEffort: request.requestedEffort,
        teammateName: request.teammateName,
        assignTo: request.to ?? 'auto',
        title: request.detail.split('\n')[0]!.slice(0, 160),
        detail: request.detail,
        paths: request.paths,
      })
    }
    if (request.action === 'review-plan') {
      if (!request.taskId || request.approved === undefined) throw new Error('Choose the task and approve or reject its plan')
      return coord.reviewExternalProtocolPlan(identity, { taskId: request.taskId, approved: request.approved, summary: request.detail })
    }
    if (request.action === 'decision') {
      if (!request.taskId || !request.decisionId) throw new Error('Choose the decision to answer')
      return coord.resolveProtocolDecisionAdmin(identity.runId, { taskId: request.taskId, decisionId: request.decisionId, answer: request.detail })
    }
    if (!request.to) throw new Error('Choose a teammate')
    return coord.sendExternalProtocolMessage(identity, { to: request.to, body: request.detail, inReplyTo: request.inReplyTo, kind: request.inReplyTo ? 'response' : 'request' })
  })
  return readTuiSessionCoordinator(sessionId, provider)
}

/** Create a session (or a pending draft) locally or on the attached daemon. */
export async function createTuiSession(params: {
  provider?: AgentProvider
  /** Which configured agent, for a provider with more than one (`acp`). */
  providerInstanceId?: string
  cwd?: string
  title?: string
}): Promise<{ sessionId: string; provider: AgentProvider; cwd: string; isPending: boolean; providerInstanceId?: string }> {
  const finishLoading = beginProviderLoading(params.provider)
  try {
    if (isRemoteAttached()) {
      return await remoteJson('/api/sessions/new', { method: 'POST', body: JSON.stringify(params) })
    }
    const { providerInstanceId, ...rest } = params
    const { withProviderInstance } = await import('../providerInstances')
    if (params.provider !== 'acp') {
      if (!params.provider || !providerInstanceId || providerInstanceId === params.provider) return await (await sendPath()).createNewViewSession(rest)
      // A second account: the session is created in, and remembered as, that instance.
      const created = await withProviderInstance(providerInstanceId, params.provider, async () => (await sendPath()).createNewViewSession(rest))
      noteTuiSessionInstance({ ...created, providerInstanceId })
      return { ...created, providerInstanceId }
    }
    // A new ACP chat goes to the agent the caller named (the one picked, else the
    // selected session's), else the default one, else — when that has no command
    // — the first agent that does.
    const staffing = (await (await import('../coordinatorCapabilities')).readCoordinatorStaffing()).filter((choice) => choice.provider === 'acp')
    const instanceId = staffing.find((choice) => choice.providerInstanceId === providerInstanceId)?.providerInstanceId
      ?? staffing.find((choice) => choice.isDefault)?.providerInstanceId
      ?? staffing[0]?.providerInstanceId
      ?? 'acp'
    const created = await withProviderInstance(instanceId, 'acp', async () => (await sendPath()).createNewViewSession(rest))
    return { ...created, providerInstanceId: instanceId }
  } finally {
    finishLoading()
  }
}

/** Fork a session into a new one — whole, or up to and including `upToMessageId`. */
export async function forkTuiSession(
  session: { sessionId: string; provider?: AgentProvider; providerInstanceId?: string },
  upToMessageId?: string,
): Promise<{ sessionId: string }> {
  const body = upToMessageId ? { upToMessageId } : {}
  if (isRemoteAttached()) {
    return remoteJson(encodeSessionPath(session.sessionId, '/fork'), {
      method: 'POST',
      body: JSON.stringify({ provider: session.provider, ...body }),
    })
  }
  return asSessionInstance(session, async () => {
    const forked = await (await sendPath()).forkViewSession({ sessionId: session.sessionId, provider: session.provider, body })
    // The copy lives where its original does.
    noteTuiSessionInstance({ ...session, sessionId: forked.sessionId })
    return forked
  })
}

/** Codex revert (`beforeTurnId`) or OpenCode revert (`userMessageId`), in place. */
export async function rewindTuiSession(
  session: { sessionId: string; provider?: AgentProvider; providerInstanceId?: string },
  body: { beforeTurnId?: string; userMessageId?: string },
): Promise<Record<string, unknown>> {
  if (isRemoteAttached()) {
    return remoteJson(encodeSessionPath(session.sessionId, '/rewind'), {
      method: 'POST',
      body: JSON.stringify({ provider: session.provider, ...body }),
    })
  }
  return asSessionInstance(session, async () => (await sendPath()).rewindOrRollbackViewSession({ sessionId: session.sessionId, provider: session.provider, body }))
}

/** Warm the send path (Claude pool spawn, Codex thread resume) while the user types. */
export async function prewarmTuiSession(
  session: Session,
  opts?: { model?: string; effort?: import('../types').ReasoningEffortLevel; isPending?: boolean },
): Promise<void> {
  const finishLoading = beginProviderLoading(session.provider)
  try {
    if (isRemoteAttached()) {
      await remoteJson(encodeSessionPath(session.sessionId, '/composer'), {
        method: 'POST',
        body: JSON.stringify({
          provider: session.provider,
          cwd: session.cwd ?? undefined,
          model: opts?.model,
          effort: opts?.effort,
          isPending: opts?.isPending,
        }),
      })
      return
    }
    await asSessionInstance(session, async () => (await sendPath()).prewarmViewSession({
      sessionId: session.sessionId,
      provider: session.provider as AgentProvider | undefined,
      cwd: session.cwd ?? undefined,
      model: opts?.model,
      effort: opts?.effort,
      isPending: opts?.isPending,
    }))
  } finally {
    finishLoading()
  }
}

export async function readTuiSessionDiagnostics(
  session: Session,
): Promise<{ sections: SessionDiagnosticSection[]; currentModel: string | null }> {
  if (isRemoteAttached()) {
    return remoteJson(encodeSessionPath(session.sessionId, `/diagnostics${providerQuery(session.provider)}`))
  }
  return readViewSessionDiagnostics(session.sessionId, session.provider as AgentProvider | undefined)
}

export async function runTuiSessionAction(
  session: Session,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (isRemoteAttached()) {
    const { result } = await remoteJson<{ result: Record<string, unknown> }>(
      encodeSessionPath(session.sessionId, '/actions'),
      { method: 'POST', body: JSON.stringify({ ...body, provider: session.provider }) },
    )
    return result ?? {}
  }
  return asSessionInstance(session, async () => (await sendPath()).runViewSessionAction({
    sessionId: session.sessionId,
    body,
    provider: session.provider as AgentProvider | undefined,
  }))
}

export async function readTuiSessionBookmarkIds(session: Session): Promise<string[]> {
  return getSessionBookmarkIds(session.provider as AgentProvider | undefined, session.sessionId)
}

export async function toggleTuiSessionBookmark(
  session: Session,
  uuid: string,
  bookmarked: boolean,
  meta?: SetMessageBookmarkInput['meta'],
): Promise<string[]> {
  const next = await setMessageBookmark({
    provider: session.provider as AgentProvider | undefined,
    sessionId: session.sessionId,
    uuid,
    bookmarked,
    meta,
  })
  return next.map((record) => record.uuid)
}

export async function readTuiAllBookmarks(): Promise<MessageBookmark[]> {
  return listAllBookmarks()
}

// The prompt library parses front matter with `yaml`; it loads when the
// library is first opened, not with every TUI launch.
const promptLibrary = () => import('../promptLibrary')

export async function readTuiPrompts(): Promise<PromptSummary[]> {
  return (await promptLibrary()).listPrompts()
}

export async function readTuiPrompt(slug: string): Promise<PromptRecord | null> {
  return (await promptLibrary()).getPrompt(slug)
}

export async function saveTuiPrompt(input: SavePromptInput): Promise<PromptRecord> {
  return (await promptLibrary()).savePrompt(input)
}

export async function deleteTuiPrompt(slug: string): Promise<boolean> {
  return (await promptLibrary()).deletePrompt(slug)
}

export async function readTuiCoordinatorResult(sessionId: string, provider: AgentProvider, taskId: string): Promise<import('../coordinatorResultReview').CoordinatorResultReview> {
  if (isRemoteAttached()) return remoteJson(`${encodeSessionPath(sessionId, '/coordination/results/' + encodeURIComponent(taskId))}${providerQuery(provider)}`)
  return (await import('../coordinatorResultReviewServer')).readCoordinatorResultReview(sessionId, provider, taskId)
}
