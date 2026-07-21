import {
  buildThreadedMessages,
  buildThreadedMessagesIncremental,
  type IncrementalThreadingCache,
  type ThreadedMessage,
} from '../threading'
import { getConfiguredProvider, setConfiguredProvider } from '../providerState'
import {
  getConfiguredTuiDensity,
  getConfiguredTuiDiffLayout,
  getConfiguredTuiFocusMode,
  getConfiguredTuiRailVisible,
  getConfiguredTuiSessionReaderState,
  getConfiguredTuiSidebarSort,
  getConfiguredTuiSidebarWidth,
  getConfiguredTuiShowToolCalls,
  getConfiguredTuiTabsEnabled,
  getConfiguredTuiTheme,
  getConfiguredTuiTranscriptView,
  getConfiguredTuiTranscriptWidth,
  getConfiguredTuiVelocityScroll,
  setConfiguredTuiDensity,
  setConfiguredTuiDiffLayout,
  setConfiguredTuiFocusMode,
  setConfiguredTuiRailVisible,
  setConfiguredTuiSessionReaderState,
  setConfiguredTuiSidebarSort,
  setConfiguredTuiShowToolCalls,
  setConfiguredTuiSidebarWidth,
  setConfiguredTuiTabsEnabled,
  setConfiguredTuiTheme,
  setConfiguredTuiThemeSync,
  setConfiguredTuiTranscriptView,
  setConfiguredTuiTranscriptWidth,
  setConfiguredTuiVelocityScroll,
  type TuiSessionReaderState,
  type TuiDiffLayout,
  type TuiSidebarSort,
  type TuiTranscriptWidth,
} from '../tuiState'
import {
  createNewViewSession,
  listViewRunningSessions,
  readClaudeObservedFilePaths,
  readViewRuntimeActivity,
  listViewSessionMessages,
  listViewSessions,
  patchViewSession,
  interruptViewSession,
  prewarmViewSession,
  readViewSessionComposerOptions,
  readViewSessionDiagnostics,
  readViewSessionInfo,
  readViewSessionModels,
  readViewSessionSlashCommands,
  runViewSessionAction,
  streamViewSessionTurn,
} from '../sessionBackend'
import { dismissViewerAttention } from '../viewerAttention'
import {
  encodeSessionPath,
  isRemoteAttached,
  providerQuery,
  remoteJson,
  remoteStream,
} from './remote'
import {
  getSessionBookmarkIds,
  listAllBookmarks,
  setMessageBookmark,
  type MessageBookmark,
  type SetMessageBookmarkInput,
} from '../messageBookmarks'
import {
  deletePrompt,
  getPrompt,
  listPrompts,
  savePrompt,
  type PromptRecord,
  type PromptSummary,
  type SavePromptInput,
} from '../promptLibrary'
import {
  createWorktreeTask,
  findWorktreeTaskForCwd,
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
  rejectWorkingHunk,
  restoreCheckpoint,
  type CheckpointFileChange,
  type TurnCheckpoint,
  type WorkingDiffHunk,
} from '../checkpoints'
import {
  appendProtocolEvent,
  cleanupProtocolRunWorktrees,
  deleteProtocolRun,
  listProtocolRuns,
  observeCoordinatorSessionTurn,
  readProtocolRun,
  startProtocolRun,
  stopProtocolRun,
  validateWorktreeTaskLocks,
} from '../agentCoordination'
import type { AgentProtocolEvent, ProtocolRun, ProtocolRunSnapshot, StartProtocolRunParams, StartProtocolRunResult } from '../agentProtocol'
import type { AgentProvider, ContextUsage, ProviderSelection, Session, SessionDiagnosticSection, SessionInfo, SessionMessage, SessionModelInfo } from '../types'
import type { TuiDensity, TuiThemeMode, TuiTranscriptView } from '../../tui/theme'
import { queueClaudeReadStateSeeds } from '../claudePool'

const DEFAULT_SESSION_LIMIT = 200
const CLAUDE_MESSAGE_LIMIT = 2000
const TOOL_HEAVY_PROVIDER_MESSAGE_LIMIT = 2000

export type TuiSessionDetail = {
  info: SessionInfo | null
  rawMessages: SessionMessage[]
  threadedMessages: ThreadedMessage[]
  contextUsage: ContextUsage | null
}

export type TuiSessionMetadata = {
  models: SessionModelInfo[]
  currentModel: string | null
  contextUsage: ContextUsage | null
}

export async function readTuiProvider(): Promise<ProviderSelection> {
  if (isRemoteAttached()) {
    const { provider } = await remoteJson<{ provider: ProviderSelection }>('/api/provider')
    return provider
  }
  return getConfiguredProvider()
}

export async function writeTuiProvider(provider: ProviderSelection): Promise<void> {
  if (isRemoteAttached()) {
    await remoteJson('/api/provider', { method: 'PATCH', body: JSON.stringify({ provider }) })
    return
  }
  await setConfiguredProvider(provider)
}

export async function readTuiTheme(): Promise<TuiThemeMode> {
  return getConfiguredTuiTheme()
}

export async function writeTuiTheme(theme: TuiThemeMode): Promise<void> {
  await setConfiguredTuiTheme(theme)
}

export function writeTuiThemeSync(theme: TuiThemeMode): void {
  setConfiguredTuiThemeSync(theme)
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

export async function readTuiTabsEnabled(): Promise<boolean> {
  return getConfiguredTuiTabsEnabled()
}

export async function writeTuiTabsEnabled(tabsEnabled: boolean): Promise<void> {
  await setConfiguredTuiTabsEnabled(tabsEnabled)
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

export async function readTuiSidebarSort(): Promise<TuiSidebarSort> {
  return getConfiguredTuiSidebarSort()
}

export async function writeTuiSidebarSort(sidebarSort: TuiSidebarSort): Promise<void> {
  await setConfiguredTuiSidebarSort(sidebarSort)
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

export async function readTuiSessions(provider: ProviderSelection): Promise<Session[]> {
  if (isRemoteAttached()) {
    const { sessions } = await remoteJson<{ sessions: Session[] }>(
      `/api/sessions?limit=${DEFAULT_SESSION_LIMIT}&offset=0&includeWorktrees=true&provider=${encodeURIComponent(provider)}`,
    )
    return sessions
  }
  return listViewSessions({
    limit: DEFAULT_SESSION_LIMIT,
    offset: 0,
    includeWorktrees: true,
    provider,
  })
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

export async function readTuiSessionDetailSource(session: Session): Promise<{
  info: SessionInfo | null
  rawMessages: SessionMessage[]
}> {
  const messageLimit = session.provider === 'claude'
    ? CLAUDE_MESSAGE_LIMIT
    : TOOL_HEAVY_PROVIDER_MESSAGE_LIMIT
  if (isRemoteAttached()) {
    const query = providerQuery(session.provider)
    const [infoResult, windowResult] = await Promise.all([
      remoteJson<{ info: SessionInfo | null }>(encodeSessionPath(session.sessionId, query))
        .catch(() => ({ info: null })),
      remoteJson<{ messages: SessionMessage[] }>(
        encodeSessionPath(
          session.sessionId,
          `/messages?limit=${messageLimit}&offset=0&tail=1${session.provider ? `&provider=${encodeURIComponent(session.provider)}` : ''}`,
        ),
      ),
    ])
    return { info: infoResult.info, rawMessages: windowResult.messages }
  }
  const [info, messages] = await Promise.all([
    readViewSessionInfo(session.sessionId, session.provider),
    listViewSessionMessages(
      session.sessionId,
      { limit: messageLimit, offset: 0, tail: true },
      session.provider,
    ),
  ])

  return {
    info,
    rawMessages: messages,
  }
}

export async function readTuiSessionDetail(session: Session): Promise<TuiSessionDetail> {
  const { info, rawMessages } = await readTuiSessionDetailSource(session)

  return {
    info,
    rawMessages,
    threadedMessages: threadMessages(session, rawMessages),
    contextUsage: null,
  }
}

export async function readTuiSessionMetadata(session: Session): Promise<TuiSessionMetadata> {
  if (isRemoteAttached()) {
    return remoteJson<TuiSessionMetadata>(
      encodeSessionPath(session.sessionId, `/models${providerQuery(session.provider)}`),
    )
  }
  return readViewSessionModels(session.sessionId, session.provider)
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
  const response = await streamViewSessionTurn({
    sessionId: session.sessionId,
    signal: signal ?? new AbortController().signal,
    body,
    provider: session.provider as AgentProvider | undefined,
  })
  return observeCoordinatorSessionTurn(session.sessionId, response)
}

/**
 * Interrupt the session's running turn. Resolves to the uuids of queued async
 * messages that survive the interrupt (Claude interrupt_receipt_v1), when the
 * provider reports them.
 */
export async function interruptTuiSessionTurn(session: { sessionId: string; provider?: AgentProvider; turnRequestId?: string }): Promise<string[] | undefined> {
  if (isRemoteAttached()) {
    const response = await remoteJson<{ stillQueued?: unknown }>(encodeSessionPath(session.sessionId, '/interrupt'), {
      method: 'POST',
      body: JSON.stringify({
        provider: session.provider,
        turnRequestId: session.turnRequestId,
      }),
    })
    return Array.isArray(response?.stillQueued)
      ? response.stillQueued.filter((uuid): uuid is string => typeof uuid === 'string')
      : undefined
  }
  return await interruptViewSession(session.sessionId, session.turnRequestId)
}

/**
 * Snapshot of every session with a turn running in this process, each carrying
 * any Claude prompts (tool permissions / AskUserQuestion / plan approval) the
 * turn is blocked on. The TUI and its backend share one process, so this
 * registry read is synchronous and authoritative — it powers live-turn
 * reattach and the cross-session attention surfaces.
 */
export async function listTuiRunningSessions(): Promise<ReturnType<typeof listViewRunningSessions>> {
  if (isRemoteAttached()) {
    const { running } = await remoteJson<{ running: ReturnType<typeof listViewRunningSessions> }>('/api/sessions/running')
    return running
  }
  return listViewRunningSessions()
}

export type TuiRuntimeActivity = ReturnType<typeof readViewRuntimeActivity>

export async function readTuiRuntimeActivity(): Promise<TuiRuntimeActivity> {
  if (isRemoteAttached()) return remoteJson<TuiRuntimeActivity>('/api/sessions/running')
  return readViewRuntimeActivity()
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
  const validation = await validateWorktreeTaskLocks(task)
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

export async function readTuiCheckpointDiff(cwd: string, sha: string, filePath?: string): Promise<string> {
  return diffSinceCheckpoint(cwd, sha, filePath)
}

export async function restoreTuiCheckpoint(
  cwd: string,
  sha: string,
  paths?: string[],
  context?: { sessionId?: string; provider?: string },
): Promise<{ restored: number; deleted: number }> {
  const result = await restoreCheckpoint(cwd, sha, paths)
  if (context?.provider === 'claude' && context.sessionId) {
    const observedPaths = await readClaudeObservedFilePaths(context.sessionId, cwd).catch(() => [])
    await queueClaudeReadStateSeeds(context.sessionId, cwd, observedPaths)
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

export type { TurnCheckpoint, CheckpointFileChange, WorkingDiffHunk }

export async function startTuiProtocolRun(params: StartProtocolRunParams): Promise<StartProtocolRunResult> {
  if (isRemoteAttached()) {
    return remoteJson('/api/agent-protocol/runs', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }
  return startProtocolRun(params)
}

export async function readTuiProtocolRun(runId: string): Promise<ProtocolRunSnapshot | null> {
  if (isRemoteAttached()) {
    return remoteJson(`/api/agent-protocol/runs/${encodeURIComponent(runId)}`)
  }
  return readProtocolRun(runId)
}

export async function listTuiProtocolRuns(limit?: number): Promise<ProtocolRun[]> {
  if (isRemoteAttached()) {
    const query = limit === undefined ? '' : `?limit=${encodeURIComponent(String(limit))}`
    const { runs } = await remoteJson<{ runs: ProtocolRun[] }>(`/api/agent-protocol/runs${query}`)
    return runs
  }
  return listProtocolRuns(limit)
}

export async function stopTuiProtocolRun(runId: string): Promise<ProtocolRunSnapshot | null> {
  if (isRemoteAttached()) {
    return remoteJson(`/api/agent-protocol/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' })
  }
  return stopProtocolRun(runId)
}

export async function cleanupTuiProtocolRunWorktrees(runId: string, opts?: { force?: boolean }): Promise<Awaited<ReturnType<typeof cleanupProtocolRunWorktrees>>> {
  if (isRemoteAttached()) {
    return remoteJson(`/api/agent-protocol/runs/${encodeURIComponent(runId)}/cleanup`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    })
  }
  return cleanupProtocolRunWorktrees(runId, opts)
}

export async function deleteTuiProtocolRun(runId: string): Promise<{ deleted: boolean; keptWorktrees: string[] }> {
  if (isRemoteAttached()) {
    return remoteJson(`/api/agent-protocol/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' })
  }
  return deleteProtocolRun(runId)
}

export async function appendTuiProtocolEvent(event: AgentProtocolEvent): Promise<ProtocolRunSnapshot | null> {
  if (isRemoteAttached()) {
    return remoteJson(`/api/agent-protocol/runs/${encodeURIComponent(event.runId)}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    })
  }
  return appendProtocolEvent(event)
}

/** Create a session (or a pending draft) locally or on the attached daemon. */
export async function createTuiSession(params: {
  provider?: AgentProvider
  cwd?: string
  title?: string
}): Promise<{ sessionId: string; provider: AgentProvider; cwd: string; isPending: boolean }> {
  if (isRemoteAttached()) {
    return remoteJson('/api/sessions/new', { method: 'POST', body: JSON.stringify(params) })
  }
  return createNewViewSession(params)
}

export async function readTuiSlashCommands(
  sessionId: string,
  provider?: AgentProvider,
): Promise<Awaited<ReturnType<typeof readViewSessionSlashCommands>>> {
  if (isRemoteAttached()) {
    const { commands } = await remoteJson<{ commands: Awaited<ReturnType<typeof readViewSessionSlashCommands>> }>(
      encodeSessionPath(sessionId, `/commands${providerQuery(provider)}`),
    )
    return commands
  }
  return readViewSessionSlashCommands(sessionId, provider)
}

export async function readTuiComposerOptions(
  sessionId: string,
  provider?: AgentProvider,
): Promise<Awaited<ReturnType<typeof readViewSessionComposerOptions>>> {
  if (isRemoteAttached()) {
    return remoteJson(encodeSessionPath(sessionId, `/composer${providerQuery(provider)}`))
  }
  return readViewSessionComposerOptions(sessionId, provider)
}

/** Warm the send path (Claude pool spawn, Codex thread resume) while the user types. */
export async function prewarmTuiSession(
  session: Session,
  opts?: { model?: string; effort?: import('../types').ReasoningEffortLevel; isPending?: boolean },
): Promise<void> {
  // No prewarm over the wire: the daemon warms its own pool on send, and a
  // remote prewarm per keystroke-focus would be pure request noise.
  if (isRemoteAttached()) return
  await prewarmViewSession({
    sessionId: session.sessionId,
    provider: session.provider as AgentProvider | undefined,
    cwd: session.cwd ?? undefined,
    model: opts?.model,
    effort: opts?.effort,
    isPending: opts?.isPending,
  })
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
  return runViewSessionAction({
    sessionId: session.sessionId,
    body,
    provider: session.provider as AgentProvider | undefined,
  })
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

export async function readTuiPrompts(): Promise<PromptSummary[]> {
  return listPrompts()
}

export async function readTuiPrompt(slug: string): Promise<PromptRecord | null> {
  return getPrompt(slug)
}

export async function saveTuiPrompt(input: SavePromptInput): Promise<PromptRecord> {
  return savePrompt(input)
}

export async function deleteTuiPrompt(slug: string): Promise<boolean> {
  return deletePrompt(slug)
}
