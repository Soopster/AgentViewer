// OpenCode session reads plus the transcript-freshness bookkeeping that sits
// between its event stream and its HTTP API. Shared by the OpenCode adapter
// (lib/adapters/opencode.ts) and the send path in lib/sessionBackend.ts, so it
// lives outside both to avoid an import cycle through the adapter registry.

import { getOpenCodeClient } from './opencodeClient'
import { MAPPED_MESSAGE_CACHE_MAX } from './mappedMessagesCache'
import type {
  Message as OpenCodeMessage,
  Part as OpenCodePart,
  Session as OpenCodeSession,
} from '@opencode-ai/sdk'

export const OPENCODE_OPTIONS = {
  responseStyle: 'data' as const,
  throwOnError: true as const,
}

/** The SDK returns either the value or a `{ data }` envelope depending on the
 *  client and endpoint; normalize both to the value. */
export function openCodeData<T>(response: T | { data: T }): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data: T }).data
  }
  return response as T
}

export async function getOpenCodeSession(sessionId: string): Promise<OpenCodeSession> {
  const client = await getOpenCodeClient()
  const response = await client.session.get({
    ...OPENCODE_OPTIONS,
    path: { id: sessionId },
  })
  return openCodeData<OpenCodeSession>(response)
}

export async function getOpenCodeSessionMessages(sessionId: string): Promise<Array<{ info: OpenCodeMessage; parts: OpenCodePart[] }>> {
  const client = await getOpenCodeClient()
  const response = await client.session.messages({
    ...OPENCODE_OPTIONS,
    path: { id: sessionId },
    query: { limit: 2000 },
  })
  return openCodeData<Array<{ info: OpenCodeMessage; parts: OpenCodePart[] }>>(response)
}

/** OpenCode's event bus is scoped per directory, and a session's directory
 *  comes from the session record itself — not from the client's cwd. */
export function openCodeDirectoryQuery(session: OpenCodeSession): { directory?: string } | undefined {
  return session.directory ? { directory: session.directory } : undefined
}

// OpenCode events invalidate transcript mappings immediately, but the event
// stream is only an optimization: a startup/reconnect race must not leave an
// empty or partial transcript authoritative forever. Revalidate against the
// SDK often enough that the active transcript's fallback poll is meaningful.
export const OPENCODE_TRANSCRIPT_EVENT_CACHE_MAX_AGE_MS = 1_000

const openCodeTranscriptVerifications = new Map<string, {
  version: string
  signature: string
  at: number
}>()

export function readOpenCodeTranscriptVerification(sessionId: string) {
  return openCodeTranscriptVerifications.get(sessionId)
}

export function touchOpenCodeTranscriptVerification(sessionId: string, version: string, signature: string): void {
  openCodeTranscriptVerifications.delete(sessionId)
  openCodeTranscriptVerifications.set(sessionId, { version, signature, at: Date.now() })
  while (openCodeTranscriptVerifications.size > MAPPED_MESSAGE_CACHE_MAX) {
    const oldest = openCodeTranscriptVerifications.keys().next().value
    if (oldest === undefined) break
    openCodeTranscriptVerifications.delete(oldest)
  }
}

export function forgetOpenCodeTranscriptVerification(sessionId: string): void {
  openCodeTranscriptVerifications.delete(sessionId)
}

export function openCodeTranscriptVerificationCount(): number {
  return openCodeTranscriptVerifications.size
}
