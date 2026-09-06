// Codex thread reads, resume bookkeeping, and error classification — shared by
// the Codex adapter (lib/adapters/codex.ts) and the send path still in
// lib/sessionBackend.ts. It lives in its own module so the adapter can reach
// these without importing sessionBackend, which imports the adapter registry.
//
// The resume cache is deliberately process-global: thread/resume materializes
// a rollout server-side and the thread then stays live for the app-server's
// lifetime, so re-paying that RPC on every send would add a serial round-trip
// ahead of turn/start and show up directly as first-token latency.

import { getCodexClient } from './codexClient'
import type { CodexResponseFor } from './codexProtocol'
import { getProviderCapabilities } from './provider'
import { currentProviderInstanceId } from './providerInstances'
import type { SessionInfo } from './types'
import type { Thread as CodexThread, ThreadResumeResponse as CodexThreadResumeResponse } from './codex-schema/v2'

export async function readCodexThread(sessionId: string, includeTurns: boolean) {
  const client = getCodexClient()
  const response = await client.request('thread/read', {
    threadId: sessionId,
    includeTurns,
  })
  return response.thread
}

export async function listCodexTurnsFull(sessionId: string): Promise<CodexThread['turns']> {
  const client = getCodexClient()
  const turns: CodexThread['turns'] = []
  let cursor: string | null = null

  do {
    const response: CodexResponseFor<'thread/turns/list'> = await client.request('thread/turns/list', {
      threadId: sessionId,
      cursor,
      limit: 200,
      sortDirection: 'asc',
      itemsView: 'full',
    })
    turns.push(...response.data)
    cursor = response.nextCursor
  } while (cursor)

  return turns
}

export async function readCodexThreadWithFullTurns(sessionId: string): Promise<CodexThread> {
  const thread = await readCodexThread(sessionId, false)
  try {
    const turns = await listCodexTurnsFull(sessionId)
    return { ...thread, turns }
  } catch (err) {
    if (isCodexMissingRolloutError(err)) return { ...thread, turns: [] }
    // Older app-server builds populated `thread/read(includeTurns)` before
    // the paginated turns API existed. Keep that as a fallback, but prefer
    // `itemsView: "full"` above because it matches live Codex CLI state.
    return readCodexThread(sessionId, true)
  }
}

export function isCodexMissingRolloutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return (
    /no rollout found for thread id/i.test(message) ||
    /thread not found:/i.test(message) ||
    /thread .+ is not materialized yet/i.test(message) ||
    /includeTurns is unavailable before first user message/i.test(message)
  )
}

export function isCodexActiveWriterError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /thread .+ already has an active writer/i.test(message)
}

export function pendingCodexSessionInfo(sessionId: string, tag: string | null): SessionInfo {
  return {
    sessionId,
    summary: 'New session',
    lastModified: Date.now(),
    tag: tag ?? undefined,
    provider: 'codex',
    capabilities: getProviderCapabilities('codex'),
  }
}

export async function resumeCodexThread(sessionId: string): Promise<CodexThreadResumeResponse> {
  const client = getCodexClient()
  return client.request('thread/resume', {
    threadId: sessionId,
  })
}

// Threads already resumed on the current app-server process, mapped to the
// model reported at resume time. thread/resume materializes the rollout
// server-side; once done the thread stays live for the process lifetime, so
// paying the RPC on every send just added a serial round-trip ahead of
// turn/start (first-token latency). Cleared wholesale when the app-server
// child exits — a respawned server has no live threads — and per-thread when
// turn/start reports a missing rollout (see createCodexStream's retry).
declare global {
  // eslint-disable-next-line no-var
  var __agentViewerCodexResumedThreads: Map<string, string | null> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCodexResumeInvalidators: Set<string> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCodexResumeInflight: Map<string, Promise<{ model: string | null }>> | undefined
}
const codexResumedThreads = globalThis.__agentViewerCodexResumedThreads
  ?? (globalThis.__agentViewerCodexResumedThreads = new Map<string, string | null>())
const codexResumeInflight = globalThis.__agentViewerCodexResumeInflight
  ?? (globalThis.__agentViewerCodexResumeInflight = new Map<string, Promise<{ model: string | null }>>())
const codexResumeInvalidators = globalThis.__agentViewerCodexResumeInvalidators
  ?? (globalThis.__agentViewerCodexResumeInvalidators = new Set<string>())

export function codexThreadKey(sessionId: string): string {
  return `${currentProviderInstanceId('codex')}:${sessionId}`
}

export async function ensureCodexThreadResumed(sessionId: string): Promise<{ model: string | null }> {
  const client = getCodexClient()
  const instanceId = currentProviderInstanceId('codex')
  if (!codexResumeInvalidators.has(instanceId)) {
    codexResumeInvalidators.add(instanceId)
    client.subscribeDisconnect(() => {
      const prefix = `${instanceId}:`
      for (const key of codexResumedThreads.keys()) {
        if (key.startsWith(prefix)) codexResumedThreads.delete(key)
      }
    })
  }
  const key = codexThreadKey(sessionId)
  const cached = codexResumedThreads.get(key)
  if (cached !== undefined) return { model: cached }
  const inflight = codexResumeInflight.get(key)
  if (inflight) return inflight
  const resume = resumeCodexThread(sessionId).then((result) => {
    const model = typeof result?.model === 'string' ? result.model : null
    codexResumedThreads.set(key, model)
    return { model }
  })
  codexResumeInflight.set(key, resume)
  resume.finally(() => codexResumeInflight.delete(key)).catch(() => {})
  return resume
}
/** Record a thread as live on the current app-server with the model it resumed
 *  or started on, so the next metadata read skips thread/resume entirely.
 *  thread/start already loads the thread, so the send path marks it directly
 *  rather than paying a redundant resume round-trip. */
export function markCodexThreadResumed(sessionId: string, model: string | null): void {
  codexResumedThreads.set(codexThreadKey(sessionId), model)
}

/** Drop a thread from the resume cache: the app-server lost the rollout (a
 *  restart racing the disconnect listener), or we unsubscribed from it. The
 *  next read re-resumes. */
export function forgetCodexThreadResumed(sessionId: string): void {
  codexResumedThreads.delete(codexThreadKey(sessionId))
}
