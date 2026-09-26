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
  // Callers read only the model; without excludeTurns the response carries the
  // whole transcript, parsed and discarded on every resume.
  return client.request('thread/resume', {
    threadId: sessionId,
    excludeTurns: true,
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
  var __agentViewerCodexThreadModels: Map<string, string | null> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCodexIdlePrewarmed: Map<string, IdlePrewarm> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCodexClaimedThreads: Set<string> | undefined
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
// What each thread's model was the last time anything resumed it. Kept apart
// from the live set above because knowing a model is not the same as holding
// the thread loaded — see readCodexThreadModel.
const codexThreadModels = globalThis.__agentViewerCodexThreadModels
  ?? (globalThis.__agentViewerCodexThreadModels = new Map<string, string | null>())
const CODEX_THREAD_MODELS_LIMIT = 512
const codexModelReadInflight = new Map<string, Promise<{ model: string | null }>>()
// Threads held live by prewarm alone, oldest first. A turn claims its thread
// out of this set; see prewarmCodexThread.
type IdlePrewarm = { threadId: string; client: ReturnType<typeof getCodexClient> }
const codexIdlePrewarmed = globalThis.__agentViewerCodexIdlePrewarmed
  ?? (globalThis.__agentViewerCodexIdlePrewarmed = new Map<string, IdlePrewarm>())
const CODEX_IDLE_PREWARM_LIMIT = 1
// Threads a turn has resumed or started: prewarm never releases these.
const codexClaimedThreads = globalThis.__agentViewerCodexClaimedThreads
  ?? (globalThis.__agentViewerCodexClaimedThreads = new Set<string>())

function rememberCodexThreadModel(key: string, model: string | null): void {
  codexThreadModels.delete(key)
  codexThreadModels.set(key, model)
  if (codexThreadModels.size > CODEX_THREAD_MODELS_LIMIT) {
    const oldest = codexThreadModels.keys().next().value
    if (oldest !== undefined) codexThreadModels.delete(oldest)
  }
}

export function codexThreadKey(sessionId: string): string {
  return `${currentProviderInstanceId('codex')}:${sessionId}`
}

/** Resume a thread for a turn. The thread stays live for the app-server's
 *  lifetime, and a thread a turn has used is never released by prewarm. */
export async function ensureCodexThreadResumed(sessionId: string): Promise<{ model: string | null }> {
  const key = codexThreadKey(sessionId)
  codexClaimedThreads.add(key)
  codexIdlePrewarmed.delete(key)
  return resumeCodexThreadLive(sessionId)
}

async function resumeCodexThreadLive(sessionId: string): Promise<{ model: string | null }> {
  const client = getCodexClient()
  const instanceId = currentProviderInstanceId('codex')
  if (!codexResumeInvalidators.has(instanceId)) {
    codexResumeInvalidators.add(instanceId)
    client.subscribeDisconnect(() => {
      const prefix = `${instanceId}:`
      for (const key of codexResumedThreads.keys()) {
        if (key.startsWith(prefix)) codexResumedThreads.delete(key)
      }
      for (const key of codexIdlePrewarmed.keys()) {
        if (key.startsWith(prefix)) codexIdlePrewarmed.delete(key)
      }
      for (const key of codexClaimedThreads) {
        if (key.startsWith(prefix)) codexClaimedThreads.delete(key)
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
    rememberCodexThreadModel(key, model)
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
  const key = codexThreadKey(sessionId)
  codexClaimedThreads.add(key)
  codexIdlePrewarmed.delete(key)
  codexResumedThreads.set(key, model)
  rememberCodexThreadModel(key, model)
}

/** Drop a thread from the resume cache: the app-server lost the rollout (a
 *  restart racing the disconnect listener), or we unsubscribed from it. The
 *  next read re-resumes. */
export function forgetCodexThreadResumed(sessionId: string): void {
  const key = codexThreadKey(sessionId)
  codexResumedThreads.delete(key)
  codexIdlePrewarmed.delete(key)
  codexClaimedThreads.delete(key)
}

/** The model a thread last resumed on, if this process has learned it —
 *  without resuming. A cold read reports null rather than a guess. */
export function knownCodexThreadModel(sessionId: string): string | null {
  const key = codexThreadKey(sessionId)
  return codexResumedThreads.get(key) ?? codexThreadModels.get(key) ?? null
}

/**
 * A thread's model for a read, leaving the thread unloaded.
 *
 * Codex reports a thread's model only from thread/resume, and resuming loads
 * the thread: the app-server starts every configured MCP server for it
 * (measured at ~160MB of child processes per thread) and keeps it all until
 * the thread is unsubscribed. The read paths used to resume and never let go,
 * so each session merely browsed — neighbour prefetches included — stayed
 * loaded for the life of the app-server. A read now learns the model once,
 * remembers it, and unsubscribes unless a turn or prewarm holds the thread;
 * the app-server then unloads it (about a minute later on codex-cli 0.157).
 */
export async function readCodexThreadModel(sessionId: string): Promise<{ model: string | null }> {
  const key = codexThreadKey(sessionId)
  const live = codexResumedThreads.get(key)
  if (live !== undefined) return { model: live }
  const known = codexThreadModels.get(key)
  if (known !== undefined) return { model: known }
  const inflight = codexResumeInflight.get(key) ?? codexModelReadInflight.get(key)
  if (inflight) return inflight
  const client = getCodexClient()
  const read = resumeCodexThread(sessionId).then((result) => {
    const model = typeof result?.model === 'string' ? result.model : null
    rememberCodexThreadModel(key, model)
    // A turn or prewarm that resumed meanwhile owns the subscription now.
    if (!codexResumedThreads.has(key) && !codexResumeInflight.has(key)) {
      client.request('thread/unsubscribe', { threadId: sessionId }).catch(() => {})
    }
    return { model }
  })
  codexModelReadInflight.set(key, read)
  read.finally(() => codexModelReadInflight.delete(key)).catch(() => {})
  return read
}

/**
 * Resume a thread ahead of a likely turn, holding at most
 * CODEX_IDLE_PREWARM_LIMIT threads that no turn has used. Prewarm runs on
 * selection, so without a bound every Codex session the user looked at stayed
 * loaded — with its MCP servers — until the app-server exited. Releasing the
 * previous one when another is selected keeps first-token latency for the
 * session in front of the user and nothing for the ones behind them.
 */
export async function prewarmCodexThread(sessionId: string): Promise<void> {
  const key = codexThreadKey(sessionId)
  const client = getCodexClient()
  await resumeCodexThreadLive(sessionId)
  // A turn owns it (possibly one that joined this very resume), or it failed.
  if (codexClaimedThreads.has(key) || !codexResumedThreads.has(key)) return
  codexIdlePrewarmed.delete(key)
  codexIdlePrewarmed.set(key, { threadId: sessionId, client })
  while (codexIdlePrewarmed.size > CODEX_IDLE_PREWARM_LIMIT) {
    const [oldest, entry] = codexIdlePrewarmed.entries().next().value ?? []
    if (oldest === undefined || !entry) break
    codexIdlePrewarmed.delete(oldest)
    codexResumedThreads.delete(oldest)
    entry.client.request('thread/unsubscribe', { threadId: entry.threadId }).catch(() => {})
  }
}
