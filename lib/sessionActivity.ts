// The live-turn registry read: which sessions are running, which are waiting on
// the user, and what viewer attention is outstanding.
//
// **This is on the read path even though it describes turns** (load-bearing).
// The TUI polls it from boot, every few seconds, to drive live-turn reattach and
// the attention inbox — including in a session where the user only ever reads.
// It used to live in lib/sessionBackend.ts, so that poll loaded the entire send
// path (every provider client, harness and SDK, ~56MB) within seconds of
// startup, quietly undoing the deferral in lib/tui/service.ts.
//
// Only the pending-prompt and pending-permission payloads genuinely belong to
// the send path — they are that module's own state. The send path registers a
// reader for them when it loads, and until then this returns none, which is
// exact rather than approximate: **a pending prompt or permission cannot exist
// unless a turn has run, and running a turn is what loads the send path.** So
// "not registered" and "nothing pending" are the same answer.

import { listRunningSessionRefs, listWaitingSessions } from './sessionRuntime'
import { listViewerAttention } from './viewerAttention'
import type { AgentProvider } from './types'

export type PendingTurnPayloadReader = {
  listPendingPrompts(sessionId: string): Record<string, unknown>[]
  listPendingPermissions(sessionId: string, provider?: AgentProvider): Record<string, unknown>[]
}

let pendingReader: PendingTurnPayloadReader | null = null

/** Called by lib/sessionBackend.ts at module scope. */
export function registerPendingTurnPayloadReader(reader: PendingTurnPayloadReader): void {
  pendingReader = reader
}

export function listViewRunningSessions(): Array<{
  sessionId: string
  provider: AgentProvider
  pendingPrompts: Record<string, unknown>[]
  pendingPermissions: Record<string, unknown>[]
}> {
  return listRunningSessionRefs().map((ref) => ({
    ...ref,
    pendingPrompts: pendingReader?.listPendingPrompts(ref.sessionId) ?? [],
    pendingPermissions: pendingReader?.listPendingPermissions(ref.sessionId, ref.provider) ?? [],
  }))
}

export function readViewRuntimeActivity() {
  return {
    running: listViewRunningSessions(),
    waiting: listWaitingSessions(),
    attention: listViewerAttention(),
  }
}
