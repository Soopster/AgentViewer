import { compactStableFingerprint } from '@/lib/compactFingerprint'
import type { SessionMessage } from '@/lib/types'

const PROJECT_MESSAGE_TOTAL_MEMORY_LIMIT = 2500
const PROJECT_MESSAGE_PER_SESSION_MEMORY_LIMIT = 200

export function messageTimestampMs(message: SessionMessage): number {
  if (message.timestamp) {
    const parsed = Date.parse(message.timestamp)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

function sessionMessageKey(message: SessionMessage): string {
  return `${message.providerInstanceId ?? message.provider ?? 'claude'}:${message.uuid}`
}

function projectMessageSessionKey(message: SessionMessage): string {
  return `${message.providerInstanceId ?? message.provider ?? 'claude'}:${message.session_id}`
}

// SessionMessage objects are immutable once created (mappers build fresh
// objects on every change; mergeMessages returns the SAME object when
// unchanged), so a given reference always hashes to the same signature.
// Cache by identity so stable existing-side messages aren't deep-hashed on
// every poll/SSE tick — the bulk of per-tick main-thread CPU during long
// streaming replies into a ~220-message window. WeakMap self-collects when a
// session switch drops the references.
const apiSignatureCache = new WeakMap<SessionMessage, string>()
function apiMessageSignature(message: SessionMessage): string {
  const cached = apiSignatureCache.get(message)
  if (cached !== undefined) return cached
  const originKind = message.origin?.kind ?? ''
  const turnId = message.turnId ?? ''
  const timestamp = message.timestamp ?? ''
  const payload = compactStableFingerprint(message.message)
  const signature = [message.type, timestamp, originKind, turnId, payload].join('|')
  apiSignatureCache.set(message, signature)
  return signature
}

function mergeSortedMessages(existing: SessionMessage[], incoming: SessionMessage[]): SessionMessage[] {
  const merged: SessionMessage[] = []
  let existingIndex = 0
  let incomingIndex = 0

  while (existingIndex < existing.length && incomingIndex < incoming.length) {
    if (messageTimestampMs(existing[existingIndex]) <= messageTimestampMs(incoming[incomingIndex])) {
      merged.push(existing[existingIndex])
      existingIndex += 1
    } else {
      merged.push(incoming[incomingIndex])
      incomingIndex += 1
    }
  }

  if (existingIndex < existing.length) merged.push(...existing.slice(existingIndex))
  if (incomingIndex < incoming.length) merged.push(...incoming.slice(incomingIndex))
  return merged
}

export function mergeMessages(existing: SessionMessage[], incoming: SessionMessage[]): SessionMessage[] {
  if (incoming.length === 0) return existing

  const latestIncomingByKey = new Map<string, SessionMessage>()
  for (const message of incoming) latestIncomingByKey.set(sessionMessageKey(message), message)

  let changed = false
  const appended: SessionMessage[] = []
  const matchedKeys = new Set<string>()

  // Most stream/poll payloads are an unchanged backfill window. Avoid mapping
  // the entire retained transcript into a throwaway array on those ticks;
  // allocate a replacement array lazily only after the first real update.
  let mergedExisting: SessionMessage[] | null = null
  for (let index = 0; index < existing.length; index += 1) {
    const message = existing[index]
    const key = sessionMessageKey(message)
    const replacement = latestIncomingByKey.get(key)
    let nextMessage = message
    if (replacement) {
      matchedKeys.add(key)
      if (apiMessageSignature(message) !== apiMessageSignature(replacement)) {
        changed = true
        nextMessage = replacement
        if (!mergedExisting) mergedExisting = existing.slice(0, index)
      }
    }
    if (mergedExisting) mergedExisting.push(nextMessage)
  }

  for (const [key, message] of latestIncomingByKey) {
    if (matchedKeys.has(key)) continue
    appended.push(message)
    changed = true
  }

  if (!changed) return existing
  if (appended.length === 0) return mergedExisting ?? existing

  const additions = appended.sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b))
  return mergeSortedMessages(mergedExisting ?? existing, additions)
}

export function trimProjectMessagesForMemory(messages: SessionMessage[]): SessionMessage[] {
  if (messages.length <= PROJECT_MESSAGE_TOTAL_MEMORY_LIMIT) {
    const counts = new Map<string, number>()
    let exceedsPerSessionLimit = false
    for (const message of messages) {
      const key = projectMessageSessionKey(message)
      const next = (counts.get(key) ?? 0) + 1
      if (next > PROJECT_MESSAGE_PER_SESSION_MEMORY_LIMIT) {
        exceedsPerSessionLimit = true
        break
      }
      counts.set(key, next)
    }
    if (!exceedsPerSessionLimit) return messages
  }

  const kept: SessionMessage[] = []
  const counts = new Map<string, number>()
  for (let i = messages.length - 1; i >= 0 && kept.length < PROJECT_MESSAGE_TOTAL_MEMORY_LIMIT; i -= 1) {
    const message = messages[i]
    const key = projectMessageSessionKey(message)
    const count = counts.get(key) ?? 0
    if (count >= PROJECT_MESSAGE_PER_SESSION_MEMORY_LIMIT) continue
    counts.set(key, count + 1)
    kept.push(message)
  }
  kept.reverse()
  return kept
}

