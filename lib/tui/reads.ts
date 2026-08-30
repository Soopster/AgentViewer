// The TUI's read path: list sessions, read one session's transcript source,
// read its model + context usage. Local reads route through lib/sessionReads.ts;
// an attached daemon (`--attach`) answers the same three over HTTP.
//
// **Split out of lib/tui/service.ts for memory** (load-bearing). service.ts is
// the TUI's whole entry to the provider layer — turns, prewarm, interrupt,
// worktrees, coordinator runs — so importing it evaluates lib/sessionBackend.ts
// and with it every provider's client, harness, and SDK: ~72MB of physical
// footprint, against ~16MB for the read path's own dependencies.
//
// That is paid twice in the TUI, because tui/opentui/threadingWorker.ts runs in
// a Bun Worker — a separate JS VM with its own copy of whatever it imports —
// and that worker only ever reads. It imports this module rather than
// service.ts so it never materializes the send path at all.
//
// So: **nothing here may import lib/sessionBackend.ts or lib/tui/service.ts.**
// service.ts re-exports these three, so its callers are unaffected.

import {
  listViewSessionMessageWindow,
  listViewSessions,
  readViewSessionInfo,
  readViewSessionModels,
} from '../sessionReads'
import { encodeSessionPath, isRemoteAttached, providerQuery, remoteJson } from './remote'
import type {
  ContextUsage,
  ProviderSelection,
  Session,
  SessionInfo,
  SessionMessage,
  SessionModelInfo,
} from '../types'

const DEFAULT_SESSION_LIMIT = 200
const CLAUDE_MESSAGE_LIMIT = 2000
const TOOL_HEAVY_PROVIDER_MESSAGE_LIMIT = 2000

export type TuiSessionMetadata = {
  models: SessionModelInfo[]
  currentModel: string | null
  contextUsage: ContextUsage | null
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

export async function readTuiSessionDetailSource(session: Session): Promise<{
  info: SessionInfo | null
  rawMessages: SessionMessage[]
  externalWriter?: boolean
}> {
  const messageLimit = session.provider === 'claude'
    ? CLAUDE_MESSAGE_LIMIT
    : TOOL_HEAVY_PROVIDER_MESSAGE_LIMIT
  if (isRemoteAttached()) {
    const query = providerQuery(session.provider)
    const [infoResult, windowResult] = await Promise.all([
      remoteJson<{ info: SessionInfo | null }>(encodeSessionPath(session.sessionId, query))
        .catch(() => ({ info: null })),
      remoteJson<{ messages: SessionMessage[]; externalWriter?: boolean }>(
        encodeSessionPath(
          session.sessionId,
          `/messages?limit=${messageLimit}&offset=0&tail=1${session.provider ? `&provider=${encodeURIComponent(session.provider)}` : ''}`,
        ),
      ),
    ])
    return { info: infoResult.info, rawMessages: windowResult.messages, externalWriter: windowResult.externalWriter }
  }
  const [info, window] = await Promise.all([
    readViewSessionInfo(session.sessionId, session.provider),
    listViewSessionMessageWindow(
      session.sessionId,
      { limit: messageLimit, offset: 0, tail: true },
      session.provider,
    ),
  ])

  return {
    info,
    rawMessages: window.messages,
    externalWriter: window.externalWriter,
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
