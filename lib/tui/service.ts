import { buildThreadedMessages, type ThreadedMessage } from '../threading'
import { getConfiguredProvider, setConfiguredProvider } from '../providerState'
import {
  getConfiguredTuiDensity,
  getConfiguredTuiFocusMode,
  getConfiguredTuiRailVisible,
  getConfiguredTuiSessionReaderState,
  getConfiguredTuiTabsEnabled,
  getConfiguredTuiTheme,
  getConfiguredTuiTranscriptView,
  setConfiguredTuiDensity,
  setConfiguredTuiFocusMode,
  setConfiguredTuiRailVisible,
  setConfiguredTuiSessionReaderState,
  setConfiguredTuiTabsEnabled,
  setConfiguredTuiTheme,
  setConfiguredTuiTranscriptView,
  type TuiSessionReaderState,
} from '../tuiState'
import {
  listViewSessionMessages,
  listViewSessions,
  readViewSessionInfo,
  readViewSessionModels,
} from '../sessionBackend'
import type { ContextUsage, ProviderSelection, Session, SessionInfo, SessionMessage } from '../types'
import type { TuiDensity, TuiThemeMode, TuiTranscriptView } from '../../tui/theme'

const DEFAULT_SESSION_LIMIT = 200
const DEFAULT_MESSAGE_LIMIT = 400

export type TuiSessionDetail = {
  info: SessionInfo | null
  rawMessages: SessionMessage[]
  threadedMessages: ThreadedMessage[]
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

export async function readTuiRailVisible(): Promise<boolean> {
  return getConfiguredTuiRailVisible()
}

export async function writeTuiRailVisible(railVisible: boolean): Promise<void> {
  await setConfiguredTuiRailVisible(railVisible)
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

export async function readTuiSessionDetail(session: Session): Promise<TuiSessionDetail> {
  const [info, messages, models] = await Promise.all([
    readViewSessionInfo(session.sessionId, session.provider),
    listViewSessionMessages(
      session.sessionId,
      { limit: DEFAULT_MESSAGE_LIMIT, offset: 0, tail: true },
      session.provider,
    ),
    readViewSessionModels(session.sessionId, session.provider).catch(() => null),
  ])

  return {
    info,
    rawMessages: messages,
    threadedMessages: buildThreadedMessages(messages),
    contextUsage: models?.contextUsage ?? null,
  }
}
