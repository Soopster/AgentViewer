import {
  buildThreadedMessages,
  buildThreadedMessagesIncremental,
  type IncrementalThreadingCache,
  type ThreadedMessage,
} from '../threading'
import { getConfiguredProvider, setConfiguredProvider } from '../providerState'
import {
  getConfiguredTuiDensity,
  getConfiguredTuiFocusMode,
  getConfiguredTuiRailVisible,
  getConfiguredTuiSessionReaderState,
  getConfiguredTuiSidebarSort,
  getConfiguredTuiSidebarWidth,
  getConfiguredTuiShowToolCalls,
  getConfiguredTuiTabsEnabled,
  getConfiguredTuiTheme,
  getConfiguredTuiTranscriptView,
  setConfiguredTuiDensity,
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
  type TuiSessionReaderState,
  type TuiSidebarSort,
} from '../tuiState'
import {
  listViewSessionMessages,
  listViewSessions,
  patchViewSession,
  readViewSessionDiagnostics,
  readViewSessionInfo,
  readViewSessionModels,
  runViewSessionAction,
  streamViewSessionTurn,
} from '../sessionBackend'
import type { AgentProvider, ContextUsage, ProviderSelection, Session, SessionDiagnosticSection, SessionInfo, SessionMessage, SessionModelInfo } from '../types'
import type { TuiDensity, TuiThemeMode, TuiTranscriptView } from '../../tui/theme'
import type { TuiTranscriptCard } from '../../tui/format'

const DEFAULT_SESSION_LIMIT = 200
const CLAUDE_MESSAGE_LIMIT = 2000
const TOOL_HEAVY_PROVIDER_MESSAGE_LIMIT = 2000

export type TuiSessionDetail = {
  info: SessionInfo | null
  rawMessages: SessionMessage[]
  threadedMessages: ThreadedMessage[]
  contextUsage: ContextUsage | null
  // Populated by the OpenTUI worker pipeline (readTuiSessionDetailAsync). The
  // synchronous readTuiSessionDetail path used by the legacy Ink TUI leaves
  // this undefined; the Ink renderer formats its own cards lazily.
  transcriptCards?: TuiTranscriptCard[]
  // Tag identifying the (density, showToolCalls) pair the transcriptCards
  // above were formatted with. The main thread uses this to recognise when a
  // cached detail's cards are stale relative to the user's current settings
  // (e.g. after a density toggle).
  transcriptCardsVariant?: string
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

export async function readTuiTranscriptView(): Promise<TuiTranscriptView> {
  return getConfiguredTuiTranscriptView()
}

export async function writeTuiTranscriptView(transcriptView: TuiTranscriptView): Promise<void> {
  await setConfiguredTuiTranscriptView(transcriptView)
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

export async function readTuiSidebarSort(): Promise<TuiSidebarSort> {
  return getConfiguredTuiSidebarSort()
}

export async function writeTuiSidebarSort(sidebarSort: TuiSidebarSort): Promise<void> {
  await setConfiguredTuiSidebarSort(sidebarSort)
}

export type { TuiSidebarSort }

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

const THREADING_CACHE_LIMIT = 8
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
