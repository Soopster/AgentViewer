import { buildThreadedMessages, type ThreadedMessage } from '../threading'
import { getConfiguredProvider, setConfiguredProvider } from '../providerState'
import { getConfiguredTuiTheme, setConfiguredTuiTheme } from '../tuiState'
import {
  listViewSessionMessages,
  listViewSessions,
  readViewSessionInfo,
} from '../sessionBackend'
import type { ProviderSelection, Session, SessionInfo } from '../types'
import type { TuiThemeMode } from '../../tui/theme'

const DEFAULT_SESSION_LIMIT = 200
const DEFAULT_MESSAGE_LIMIT = 400

export type TuiSessionDetail = {
  info: SessionInfo | null
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
    threadedMessages: buildThreadedMessages(messages),
  }
}
