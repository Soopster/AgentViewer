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
  listViewRunningSessions,
  listViewSessionMessages,
  listViewSessions,
  patchViewSession,
  interruptViewSession,
  prewarmViewSession,
  readViewSessionDiagnostics,
  readViewSessionInfo,
  readViewSessionModels,
  runViewSessionAction,
  streamViewSessionTurn,
} from '../sessionBackend'
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
  appendProtocolEvent,
  listProtocolRuns,
  readProtocolRun,
  startProtocolRun,
  stopProtocolRun,
  validateWorktreeTaskLocks,
} from '../agentCoordination'
import type { AgentProtocolEvent, ProtocolRun, ProtocolRunSnapshot, StartProtocolRunParams, StartProtocolRunResult } from '../agentProtocol'
import type { AgentProvider, ContextUsage, ProviderSelection, Session, SessionDiagnosticSection, SessionInfo, SessionMessage, SessionModelInfo } from '../types'
import type { TuiDensity, TuiThemeMode, TuiTranscriptView } from '../../tui/theme'

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
  return getConfiguredProvider()
}

export async function writeTuiProvider(provider: ProviderSelection): Promise<void> {
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
  return readViewSessionModels(session.sessionId, session.provider)
}

export async function patchTuiSession(session: Session, body: Record<string, unknown>): Promise<void> {
  return patchViewSession(session.sessionId, body, session.provider)
}

export async function streamTuiSessionTurn(
  session: Session,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  return streamViewSessionTurn({
    sessionId: session.sessionId,
    signal: signal ?? new AbortController().signal,
    body,
    provider: session.provider as AgentProvider | undefined,
  })
}

export async function interruptTuiSessionTurn(session: { sessionId: string }): Promise<void> {
  await interruptViewSession(session.sessionId)
}

/**
 * Snapshot of every session with a turn running in this process, each carrying
 * any Claude prompts (tool permissions / AskUserQuestion / plan approval) the
 * turn is blocked on. The TUI and its backend share one process, so this
 * registry read is synchronous and authoritative — it powers live-turn
 * reattach and the cross-session attention surfaces.
 */
export function listTuiRunningSessions(): ReturnType<typeof listViewRunningSessions> {
  return listViewRunningSessions()
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

export async function startTuiProtocolRun(params: StartProtocolRunParams): Promise<StartProtocolRunResult> {
  return startProtocolRun(params)
}

export async function readTuiProtocolRun(runId: string): Promise<ProtocolRunSnapshot | null> {
  return readProtocolRun(runId)
}

export async function listTuiProtocolRuns(limit?: number): Promise<ProtocolRun[]> {
  return listProtocolRuns(limit)
}

export async function stopTuiProtocolRun(runId: string): Promise<ProtocolRunSnapshot | null> {
  return stopProtocolRun(runId)
}

export async function appendTuiProtocolEvent(event: AgentProtocolEvent): Promise<ProtocolRunSnapshot | null> {
  return appendProtocolEvent(event)
}

/** Warm the send path (Claude pool spawn, Codex thread resume) while the user types. */
export async function prewarmTuiSession(
  session: Session,
  opts?: { model?: string; effort?: import('../types').ReasoningEffortLevel; isPending?: boolean },
): Promise<void> {
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
  return readViewSessionDiagnostics(session.sessionId, session.provider as AgentProvider | undefined)
}

export async function runTuiSessionAction(
  session: Session,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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
