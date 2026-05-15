import type { ThreadedMessage } from '../../lib/threading'
import type { SessionMessage } from '../../lib/types'

const SEPARATOR = '\x1f'
const sessionMessageFingerprintCache = new WeakMap<SessionMessage, string>()
const threadedMessageFingerprintCache = new WeakMap<ThreadedMessage, string>()

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
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
    stableStringify(message.message),
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
    stableStringify(message.usage ?? null),
    stableStringify(message.blocks),
  ].join(SEPARATOR)
  threadedMessageFingerprintCache.set(message, fingerprint)
  return fingerprint
}
