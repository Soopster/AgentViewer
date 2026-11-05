import type { ThreadedMessage } from '../../lib/threading'
import type { SessionMessage } from '../../lib/types'
import { compactStableFingerprint } from '../../lib/compactFingerprint'

const SEPARATOR = '\x1f'
const sessionMessageFingerprintCache = new WeakMap<SessionMessage, string>()
const threadedMessageFingerprintCache = new WeakMap<ThreadedMessage, string>()
type SessionMessageSequenceCacheEntry = {
  full?: SessionMessageSequenceSummary
  durable?: SessionMessageSequenceSummary
}
const sessionMessageSequenceCache = new WeakMap<SessionMessage[], SessionMessageSequenceCacheEntry>()

export type SessionMessageSequenceSummary = {
  count: number
  lastFingerprint: string | null
  sequenceFingerprint: string
}

export function sessionMessageFingerprint(message: SessionMessage | undefined): string {
  if (!message) return ''
  const cached = sessionMessageFingerprintCache.get(message)
  if (cached !== undefined) return cached
  const fingerprint = [
    message.provider ?? '',
    message.type,
    message.uuid,
    message.timestamp ?? '',
    message.turnId ?? '',
    message.origin?.kind ?? '',
    compactStableFingerprint(message.message),
  ].join(SEPARATOR)
  sessionMessageFingerprintCache.set(message, fingerprint)
  return fingerprint
}

/** Structural equality with the same notion of "same" as
 *  compactStableFingerprint: key order, array length, `-0`, and an explicit
 *  `undefined` all count. Strings compare natively, so nothing is hashed. */
function sameFingerprintedValue(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  // Deeper than any transcript payload: answer "changed" rather than recurse
  // into a cycle. A false negative only costs a re-thread.
  if (depth > 64) return false
  const aIsArray = Array.isArray(a)
  if (aIsArray !== Array.isArray(b)) return false
  if (aIsArray) {
    const left = a as unknown[]
    const right = b as unknown[]
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i++) {
      if (!sameFingerprintedValue(left[i], right[i], depth + 1)) return false
    }
    return true
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  const otherKeys = Object.keys(right)
  if (keys.length !== otherKeys.length) return false
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (key !== otherKeys[i]) return false
    if (!sameFingerprintedValue(left[key], right[key], depth + 1)) return false
  }
  return true
}

/** Whether two messages would share a sessionMessageFingerprint, decided by
 *  comparing them rather than hashing them. A live poll re-reads the transcript
 *  into fresh objects and asks this of every message; fingerprinting those
 *  objects hashed the whole session every two seconds (85ms of 114ms per poll
 *  on a 900-message session) to learn that all but the last were unchanged. */
export function sameSessionMessageContent(
  message: SessionMessage | undefined,
  previous: SessionMessage | undefined,
): boolean {
  if (message === previous) return true
  if (!message || !previous) return false
  return (message.provider ?? '') === (previous.provider ?? '')
    && message.type === previous.type
    && message.uuid === previous.uuid
    && (message.timestamp ?? '') === (previous.timestamp ?? '')
    && (message.turnId ?? '') === (previous.turnId ?? '')
    && (message.origin?.kind ?? '') === (previous.origin?.kind ?? '')
    && sameFingerprintedValue(message.message, previous.message, 0)
}

// Hash a message sequence to a fixed-size value instead of joining every
// fingerprint into one transcript-sized string. Two independent 32-bit lanes,
// plus the message count and last fingerprint at call sites, make accidental
// equality vanishingly unlikely while avoiding a large temporary allocation on
// every detail poll. The array-level caches are effective because the worker
// client deliberately preserves array identity for unchanged transcripts.
function updateSequenceHash(hash: number, value: string, multiplier: number): number {
  let next = hash
  for (let i = 0; i < value.length; i++) {
    next = Math.imul(next ^ value.charCodeAt(i), multiplier)
  }
  return Math.imul(next ^ 0x1f, multiplier)
}

function fingerprintSequence(messages: SessionMessage[], durableOnly: boolean): {
  summary: SessionMessageSequenceSummary
  hasEphemeral: boolean
} {
  let count = 0
  let lastFingerprint: string | null = null
  let hashA = 0x811c9dc5
  let hashB = 0x9e3779b9
  let hasEphemeral = false
  for (const message of messages) {
    if (message.ephemeral === true) {
      hasEphemeral = true
      if (durableOnly) continue
    }
    const fingerprint = sessionMessageFingerprint(message)
    count++
    lastFingerprint = fingerprint
    hashA = updateSequenceHash(hashA, fingerprint, 0x01000193)
    hashB = updateSequenceHash(hashB, fingerprint, 0x5bd1e995)
  }
  return {
    summary: {
      count,
      lastFingerprint,
      sequenceFingerprint: `${count}:${(hashA >>> 0).toString(16)}:${(hashB >>> 0).toString(16)}`,
    },
    hasEphemeral,
  }
}

export function sessionMessageSequenceFingerprint(messages: SessionMessage[]): string {
  const cached = sessionMessageSequenceCache.get(messages)
  if (cached?.full) return cached.full.sequenceFingerprint
  const { summary, hasEphemeral } = fingerprintSequence(messages, false)
  const entry = cached ?? {}
  entry.full = summary
  if (!hasEphemeral) entry.durable = summary
  sessionMessageSequenceCache.set(messages, entry)
  return summary.sequenceFingerprint
}

export function summarizeDurableSessionMessages(messages: SessionMessage[]): SessionMessageSequenceSummary {
  const cached = sessionMessageSequenceCache.get(messages)
  if (cached?.durable) return cached.durable
  const { summary, hasEphemeral } = fingerprintSequence(messages, true)
  const entry = cached ?? {}
  entry.durable = summary
  if (!hasEphemeral) entry.full = summary
  sessionMessageSequenceCache.set(messages, entry)
  return summary
}

export function threadedMessageFingerprint(message: ThreadedMessage | undefined): string {
  if (!message) return ''
  const cached = threadedMessageFingerprintCache.get(message)
  if (cached !== undefined) return cached
  const fingerprint = [
    message.provider ?? '',
    message.role,
    message.uuid,
    message.timestamp ?? '',
    message.origin?.kind ?? '',
    compactStableFingerprint(message.usage ?? null),
    compactStableFingerprint(message.blocks),
  ].join(SEPARATOR)
  threadedMessageFingerprintCache.set(message, fingerprint)
  return fingerprint
}
