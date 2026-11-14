import { compactStableFingerprint } from './compactFingerprint'
import type { V2Message } from './opencode2Mapping'
import type { V2Event } from './opencode2Events'

export const OPENCODE_HISTORY_PAGE_SIZE = 200
export const OPENCODE_HISTORY_FULL_REFRESH_MS = 30_000
const MAX_SESSIONS = 4
const MAX_FINGERPRINT_CHARS = 4_000_000

type Page = { data?: V2Message[]; cursor?: { next?: string | null } }
type Request = { signal?: AbortSignal }
type Snapshot = {
  messages: V2Message[]
  fingerprints: string[]
  indexes: Map<string, number>
  chars: number
  fullAt: number
}

// These arrays are immutable SDK snapshots. The mapper can use their complete
// signature without rehashing every old tool result on each live-tail poll.
const signatures = new WeakMap<object, string>()
export function rememberOpenCodeHistorySignature(snapshot: object, signature: string): void {
  signatures.set(snapshot, signature)
}
export function readOpenCodeHistorySignature(snapshot: object): string | undefined {
  return signatures.get(snapshot)
}

export class OpenCode2History {
  private snapshots = new Map<string, Snapshot>()
  private pending = new Map<string, { signal?: AbortSignal; promise: Promise<V2Message[]> }>()
  private epoch = 0

  constructor(
    private fetchPage: (sessionId: string, cursor: string | undefined, request?: Request) => Promise<Page>,
    private now: () => number = Date.now,
  ) {}

  invalidate(sessionId?: string): void {
    this.epoch += 1
    if (sessionId) this.snapshots.delete(sessionId)
    else this.snapshots.clear()
    // A caller after invalidation must not join a pre-invalidation read.
    if (sessionId) this.pending.delete(sessionId)
    else this.pending.clear()
  }

  noteEvent(event: V2Event): void {
    const data = event.data
    const sessionId = typeof data?.sessionID === 'string' ? data.sessionID : undefined
    if (!sessionId || !event.type.startsWith('session.')) return
    if (event.type === 'session.deleted' || event.type.startsWith('session.revert.') || event.type.startsWith('session.compaction.')) {
      this.invalidate(sessionId)
      return
    }
    this.epoch += 1 // an in-flight snapshot must not be blessed across an event
    this.pending.delete(sessionId)
    const snapshot = this.snapshots.get(sessionId)
    if (!snapshot) return
    const messageId = typeof data?.messageID === 'string' ? data.messageID
      : typeof data?.assistantMessageID === 'string' ? data.assistantMessageID : undefined
    const index = messageId ? snapshot.indexes.get(messageId) : undefined
    if (index !== undefined && index < snapshot.messages.length - OPENCODE_HISTORY_PAGE_SIZE) {
      this.invalidate(sessionId)
    }
  }

  read(sessionId: string, request?: Request): Promise<V2Message[]> {
    const active = this.pending.get(sessionId)
    if (active && active.signal === request?.signal) return active.promise
    const promise = this.readSnapshot(sessionId, request)
    const pending = { signal: request?.signal, promise }
    this.pending.set(sessionId, pending)
    void promise.finally(() => {
      if (this.pending.get(sessionId) === pending) this.pending.delete(sessionId)
    }).catch(() => {})
    return promise
  }

  private async readSnapshot(sessionId: string, request?: Request): Promise<V2Message[]> {
    const epoch = this.epoch
    const startedAt = this.now()
    for (const [id, snapshot] of this.snapshots) {
      if (startedAt - snapshot.fullAt >= OPENCODE_HISTORY_FULL_REFRESH_MS) this.snapshots.delete(id)
    }
    const previous = this.snapshots.get(sessionId)
    let reusable = previous
    const collected: V2Message[] = [] // newest first, as sent by the API
    const cursors = new Set<string>()
    let cursor: string | undefined
    let prefix = 0
    let merged = false
    while (true) {
      request?.signal?.throwIfAborted()
      const page = await this.fetchPage(sessionId, cursor, request)
      request?.signal?.throwIfAborted()
      const rows = page.data ?? []
      collected.push(...rows)
      const next = page.cursor?.next
      // No next cursor proves we reached the server's beginning. Do not retain
      // any cached prefix: a shorter history may have been reverted/deleted.
      if (!next) break
      if (cursors.has(next)) throw new Error('OpenCode returned a repeated message history cursor.')
      cursors.add(next)
      if (reusable && rows.length) {
        const oldest = collected[collected.length - 1]!
        const boundary = reusable.indexes.get(oldest.id)
        if (boundary !== undefined) {
          const overlap = reusable.messages.length - boundary
          const linesUp = overlap <= collected.length && reusable.messages.slice(boundary).every(
            (message, index) => message.id === collected[collected.length - 1 - index]?.id,
          )
          if (linesUp) { prefix = boundary; merged = true; break }
          // A changed overlap means deletion/reordering, not append-only tail
          // growth. Continue to the beginning instead of guessing a merge.
          reusable = undefined
        }
      }
      cursor = next
    }

    const tail = collected.reverse()
    const tailFingerprints = tail.map(message => compactStableFingerprint(message))
    const fingerprints = merged ? [...previous!.fingerprints.slice(0, prefix), ...tailFingerprints] : tailFingerprints
    // Reuse unchanged objects and the complete array on an idle verification.
    // This also lets the compatibility layer reuse already converted bundles.
    const messages = [...(merged ? previous!.messages.slice(0, prefix) : []), ...tail.map((message, index) => {
      const oldIndex = previous?.indexes.get(message.id)
      return oldIndex !== undefined && previous!.fingerprints[oldIndex] === tailFingerprints[index]
        ? previous!.messages[oldIndex]! : message
    })]
    const unchanged = previous && previous.fingerprints.length === fingerprints.length
      && previous.messages.every((message, index) => message === messages[index])
    const result = unchanged ? previous.messages : messages
    const chars = fingerprints.reduce((sum, fingerprint) => sum + parseInt(fingerprint.split(':')[0]!, 36), 0)
    rememberOpenCodeHistorySignature(result, compactStableFingerprint(fingerprints))
    if (this.epoch === epoch && chars <= MAX_FINGERPRINT_CHARS && !request?.signal?.aborted) {
      this.snapshots.delete(sessionId)
      this.snapshots.set(sessionId, {
        messages: result, fingerprints, chars,
        indexes: new Map(result.map((message, index) => [message.id, index])),
        fullAt: merged ? previous!.fullAt : startedAt,
      })
      let retained = [...this.snapshots.values()].reduce((sum, snapshot) => sum + snapshot.chars, 0)
      while (this.snapshots.size > MAX_SESSIONS || retained > MAX_FINGERPRINT_CHARS) {
        const oldest = this.snapshots.keys().next().value!
        retained -= this.snapshots.get(oldest)!.chars
        this.snapshots.delete(oldest)
      }
    }
    return result
  }
}
