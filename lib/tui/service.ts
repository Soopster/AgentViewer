import { buildThreadedMessages, type ThreadedMessage } from '../threading'
import { getConfiguredProvider, setConfiguredProvider } from '../providerState'
import {
  getConfiguredTuiDensity,
  getConfiguredTuiFocusMode,
  getConfiguredTuiRailVisible,
  getConfiguredTuiTheme,
  setConfiguredTuiDensity,
  setConfiguredTuiFocusMode,
  setConfiguredTuiRailVisible,
  setConfiguredTuiTheme,
} from '../tuiState'
import {
  type SessionMessage,
  listViewSessionMessages,
  listViewSessions,
  readViewSessionInfo,
} from '../sessionBackend'
import type { ProviderSelection, Session, SessionInfo } from '../types'
import type { TuiDensity, TuiThemeMode } from '../../tui/theme'

const DEFAULT_SESSION_LIMIT = 200
const DEFAULT_MESSAGE_LIMIT = 400

export type TuiSessionDetail = {
  info: SessionInfo | null
  rawMessages: SessionMessage[]
  threadedMessages: ThreadedMessage[]
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

export async function readTuiSessions(provider: ProviderSelection): Promise<Session[]> {
  return listViewSessions({
    limit: DEFAULT_SESSION_LIMIT,
    offset: 0,
    includeWorktrees: true,
    provider,
  })
}

export async function readTuiSessionDetail(session: Session): Promise<TuiSessionDetail> {
  const [info, messages] = await Promise.all([
    readViewSessionInfo(session.sessionId, session.provider),
    listViewSessionMessages(
      session.sessionId,
      { limit: DEFAULT_MESSAGE_LIMIT, offset: 0, tail: true },
      session.provider,
    ),
  ])

  return {
    info,
    rawMessages: messages,
    threadedMessages: buildThreadedMessages(messages),
  }
}
