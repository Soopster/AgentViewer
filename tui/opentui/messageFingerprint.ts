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

export function sameSessionMessageContent(
  message: SessionMessage | undefined,
  previous: SessionMessage | undefined,
): boolean {
  return sessionMessageFingerprint(message) === sessionMessageFingerprint(previous)
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
