// Per-session cache of mapped+sorted messages, shared by every provider
// adapter's readAllMessages. Lets idle polls skip the normalize/dedup/sort
// pipeline when the underlying transcript is unchanged: each call computes a
// cheap raw signature; on match the cached array is returned (slicing happens
// at the call site), on mismatch the transcript is re-mapped and stored.
//
// LRU-capped because each entry holds a fully normalized message array — a
// large session can be MBs (base64 images included), so this cache is the
// single largest deliberate server retainer. 4 keeps the active session (LRU
// touch on every poll) plus a few recently viewed ones resident; anything
// beyond that re-maps once on revisit instead of pinning MBs indefinitely.
//
// Keys are `<provider>:<sessionId>` so two providers holding the same session
// id cannot collide.

import type { SessionMessage } from './types'

const MAPPED_MESSAGE_TTL = 60_000
export const MAPPED_MESSAGE_CACHE_MAX = 4

type MappedMessageCacheEntry = {
  signature: string
  messages: SessionMessage[]
  ts: number
}

const mappedMessageCache = new Map<string, MappedMessageCacheEntry>()

function pruneMappedMessageCache() {
  const deadline = Date.now() - MAPPED_MESSAGE_TTL * 3
  for (const [key, entry] of mappedMessageCache) {
    if (entry.ts < deadline) mappedMessageCache.delete(key)
  }
}

export function readMappedMessagesCache(key: string, signature: string): SessionMessage[] | null {
  const cached = mappedMessageCache.get(key)
  if (cached && cached.signature === signature) {
    cached.ts = Date.now()
    // Touch LRU order so the active session stays resident under cap.
    mappedMessageCache.delete(key)
    mappedMessageCache.set(key, cached)
    return cached.messages
  }
  return null
}

/** The cached transcript regardless of signature — for the case where a fresh
 *  read is impossible (another client holds Codex's rollout writer lock) and a
 *  stale snapshot beats showing nothing. */
export function readLatestMappedMessagesCache(key: string): SessionMessage[] | null {
  const cached = mappedMessageCache.get(key)
  if (!cached) return null
  cached.ts = Date.now()
  mappedMessageCache.delete(key)
  mappedMessageCache.set(key, cached)
  return cached.messages
}

export function writeMappedMessagesCache(key: string, signature: string, messages: SessionMessage[]): SessionMessage[] {
  pruneMappedMessageCache()
  if (mappedMessageCache.has(key)) mappedMessageCache.delete(key)
  mappedMessageCache.set(key, { signature, messages, ts: Date.now() })
  while (mappedMessageCache.size > MAPPED_MESSAGE_CACHE_MAX) {
    const oldest = mappedMessageCache.keys().next().value
    if (oldest === undefined) break
    mappedMessageCache.delete(oldest)
  }
  return messages
}

/** Entry count plus total retained messages, for the server memory report.
 *  Entry count alone hides the real weight here — entries are whole mapped
 *  sessions — so both numbers are reported. */
export function mappedMessagesCacheDiagnostics(): { entries: number; messages: number } {
  let messages = 0
  for (const entry of mappedMessageCache.values()) messages += entry.messages.length
  return { entries: mappedMessageCache.size, messages }
}
