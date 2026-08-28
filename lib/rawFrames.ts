// The provider's own bytes, kept beside every message we normalize.
//
// Once a provider event becomes a SessionMessage, the frame it came from is
// gone — so "the card rendered wrong, what did the SDK actually send?" has no
// answer short of adding a console.log and reproducing. This keeps the
// original frame reachable for exactly that question.
//
// Modeled on T3 Code's `RuntimeEventRaw { source, method, payload }`, with one
// deliberate difference. There, the raw frame rides a server-only bus type and
// disappears at the ingestion boundary because nothing copies it forward — the
// boundary is implicit. We want the frame reachable from the UI, so the
// boundary has to be drawn on purpose instead:
//
//   - It is NEVER a field on SessionMessage, so it cannot ride the message
//     wire format out to every client, the TUI, or the search index.
//   - It is NEVER written to the SQLite index (lib/sessionPersistence.ts).
//   - It lives only in this process's memory, is capped, and evicts.
//   - It is served by one route that requires full scope, because a raw frame
//     contains whatever the provider sent: file contents, tool output,
//     anything a redaction pass upstream would have removed.
//
// **Retention is deliberately pinned to the mapped-message cache.** Frames are
// recorded by the mappers, and lib/mappedMessagesCache.ts serves an unchanged
// transcript *without* re-running its mapper — so a session that is cached but
// whose frames were dropped would never record them again, and the frame for a
// message you are looking at right now would be permanently missing. Bucketing
// per session under the same cap as that cache keeps the two lifetimes
// aligned: if the mapped entry survives, so do its frames; if it is evicted,
// the next read re-maps and re-records. Reading one session can no longer
// evict another's frames.

import { MAPPED_MESSAGE_CACHE_MAX } from './mappedMessagesCache'

/** Where a frame came from. Mirrors T3's tagged union so the label says both
 *  which provider and which transport produced it — `claude.sdk.message` and
 *  `acp.jsonrpc` are different enough to be worth distinguishing when reading
 *  a frame back. */
export type RawFrameSource =
  | 'claude.sdk.message'
  | 'codex.app-server.notification'
  | 'codex.thread-event'
  | 'opencode.sdk.event'
  | 'copilot.sdk.event'
  | 'pi.agent.event'
  | 'acp.jsonrpc'
  | 'lmstudio.record'

export type RawFrame = {
  source: RawFrameSource
  /** RPC method or event name, when the transport has one. */
  method?: string
  /** The provider's own discriminator for this frame (`type`, `subtype`, …). */
  messageType?: string
  payload: unknown
  capturedAt: number
}

/** Sessions retained, matched to the mapped-message cache so the two evict
 *  together (see the header). */
const RAW_FRAME_SESSION_MAX = MAPPED_MESSAGE_CACHE_MAX

/** Frames kept per session. Raw frames are the unnormalized originals, so they
 *  are strictly larger than the messages they produced; without a per-session
 *  cap a long transcript would make this the largest retainer in the process.
 *  The tail is what a reader is realistically inspecting. */
export const RAW_FRAME_PER_SESSION_MAX = 400

/** sessionId → uuid → frame. Both levels are insertion-ordered Maps used as
 *  LRUs (delete-then-set to touch). */
const bySession = new Map<string, Map<string, RawFrame>>()

function bucketFor(sessionId: string): Map<string, RawFrame> {
  const existing = bySession.get(sessionId)
  if (existing) {
    bySession.delete(sessionId)
    bySession.set(sessionId, existing)
    return existing
  }
  const created = new Map<string, RawFrame>()
  bySession.set(sessionId, created)
  while (bySession.size > RAW_FRAME_SESSION_MAX) {
    const oldest = bySession.keys().next().value
    if (oldest === undefined) break
    bySession.delete(oldest)
  }
  return created
}

/** Records the frame a message was normalized from. Silently a no-op when the
 *  message has no session or uuid to key on — provenance is a debugging aid
 *  and must never be able to fail a mapper. */
export function recordRawFrame(
  sessionId: string | undefined,
  uuid: string | undefined,
  frame: Omit<RawFrame, 'capturedAt'>,
): void {
  if (!sessionId || !uuid) return
  const bucket = bucketFor(sessionId)
  if (bucket.has(uuid)) bucket.delete(uuid)
  bucket.set(uuid, { ...frame, capturedAt: Date.now() })
  while (bucket.size > RAW_FRAME_PER_SESSION_MAX) {
    const oldest = bucket.keys().next().value
    if (oldest === undefined) break
    bucket.delete(oldest)
  }
}

/** Records one frame against every message derived from it. Mappers are not
 *  all 1:1 — a single Codex thread item or OpenCode bundle can expand into
 *  several messages — and all of them came from the same bytes. */
export function recordRawFrames(
  messages: readonly { uuid?: string; session_id?: string }[],
  frame: Omit<RawFrame, 'capturedAt'>,
): void {
  for (const message of messages) recordRawFrame(message.session_id, message.uuid, frame)
}

/** The frame a message came from, or null once it has evicted. Absence is a
 *  normal end state — callers should say "no longer retained", not "error". */
export function readRawFrame(sessionId: string, uuid: string): RawFrame | null {
  return bySession.get(sessionId)?.get(uuid) ?? null
}

export function rawFrameDiagnostics(): { sessions: number; frames: number } {
  let frames = 0
  for (const bucket of bySession.values()) frames += bucket.size
  return { sessions: bySession.size, frames }
}
