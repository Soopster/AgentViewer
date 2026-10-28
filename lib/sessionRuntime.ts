import type { AgentProvider } from './types'
import { currentProviderInstance } from './providerInstances'

export type SessionBackgroundTask = {
  id: string
  type: string
  status: string
  description: string
}

export type SessionCronWakeup = {
  id: string
  schedule: string
  recurring: boolean
  prompt: string
}

export type WaitingSession = {
  sessionId: string
  provider: AgentProvider
  providerInstanceId?: string
  backgroundTasks: SessionBackgroundTask[]
  sessionCrons: SessionCronWakeup[]
  updatedAt: number
}

type RunningSession = {
  provider: AgentProvider
  providerInstanceId?: string
  interrupt: (cancelQueued?: boolean) => Promise<unknown>
  background?: () => Promise<unknown>
  /**
   * Deliver an additional user message INTO the running turn, the way the
   * provider's own CLI does when you type while the agent works (Claude Code
   * queues it as steering input, Codex `turn/steer`, Pi `steer()`). Absent
   * when the provider has no mid-turn delivery primitive.
   */
  steer?: (text: string) => Promise<unknown>
  requestId?: string
}

type PendingInterrupt = { requestId: string; timer: ReturnType<typeof setTimeout> }

type SteerReceipt = {
  text: string
  turnRequestId?: string
  createdAt: number
  settled: boolean
  promise: Promise<{ delivered: boolean; messageUuid?: string }>
}

type SessionRuntimeState = {
  runningSessions: Map<string, RunningSession>
  waitingSessions: Map<string, WaitingSession>
  waitingObservations?: Map<string, WaitingSession>
  pendingInterrupts: Map<string, PendingInterrupt>
  /** Optional for compatibility with state created before a development HMR. */
  steerReceipts?: Map<string, SteerReceipt>
}

declare global {
  // Next.js development reloads can re-evaluate this module while provider
  // turns from the previous module instance are still alive. Keep their real
  // control closures on globalThis so the new routes can reattach, steer, and
  // interrupt instead of observing a fresh empty registry.
  // eslint-disable-next-line no-var
  var __agentViewerSessionRuntimeState: SessionRuntimeState | undefined
}

function getSessionRuntimeState(): SessionRuntimeState {
  if (!globalThis.__agentViewerSessionRuntimeState) {
    globalThis.__agentViewerSessionRuntimeState = {
      runningSessions: new Map(),
      waitingSessions: new Map(),
      pendingInterrupts: new Map(),
      steerReceipts: new Map(),
    }
  }
  globalThis.__agentViewerSessionRuntimeState.steerReceipts ??= new Map()
  globalThis.__agentViewerSessionRuntimeState.waitingObservations ??= new Map()
  return globalThis.__agentViewerSessionRuntimeState
}

const { runningSessions, waitingSessions, pendingInterrupts, steerReceipts } = getSessionRuntimeState()
const PENDING_INTERRUPT_TTL_MS = 30_000
const STEER_RECEIPT_TTL_MS = 10 * 60 * 1000
const MAX_STEER_RECEIPTS = 1_000

/** Keys include the configured account. Unscoped legacy reads only resolve a unique session. */
export type RuntimeSessionTarget = { provider: AgentProvider; providerInstanceId?: string }

function runtimeKey(sessionId: string, entries: ReadonlyMap<string, unknown> = runningSessions, target?: RuntimeSessionTarget): string {
  const active = currentProviderInstance()
  const provider = target?.provider ?? active?.provider
  const instance = target ? target.providerInstanceId ?? target.provider : active?.id ?? provider
  if (provider) return JSON.stringify([provider, instance, sessionId])
  let match: string | undefined
  for (const key of entries.keys()) {
    if (key === sessionId || (key.startsWith('[') && JSON.parse(key)[2] === sessionId)) {
      if (match !== undefined) throw new Error('Provider instance context is required for an ambiguous session ID')
      match = key
    }
  }
  return match ?? sessionId
}

// Next development reloads retain this global registry across module versions.
function migrateRuntimeKeys<T extends RuntimeSessionTarget>(entries: Map<string, T>): void {
  for (const [key, value] of entries) {
    if (key.startsWith('[')) continue
    entries.delete(key)
    entries.set(runtimeKey(key, entries, value), value)
  }
}
migrateRuntimeKeys(runningSessions)
migrateRuntimeKeys(waitingSessions)
migrateRuntimeKeys(getSessionRuntimeState().waitingObservations!)

export function setRunningSession(sessionId: string, session: RunningSession): void {
  // A new foreground turn supersedes the prior Stop-hook pause snapshot. The
  // next Stop callback will publish a fresh waiting state if work remains.
  const active = currentProviderInstance()
  const instance = session.providerInstanceId ?? (active?.provider === session.provider ? active.id : undefined)
  const key = runtimeKey(sessionId, runningSessions, { ...session, providerInstanceId: instance })
  waitingSessions.delete(key)
  runningSessions.set(key, instance && instance !== session.provider ? { ...session, providerInstanceId: instance } : session)
  const pendingKey = currentProviderInstance() ? key : pendingInterrupts.has(key) ? key : sessionId
  const pending = pendingInterrupts.get(pendingKey)
  if (pending && session.requestId === pending.requestId) {
    clearTimeout(pending.timer)
    pendingInterrupts.delete(pendingKey)
    void session.interrupt().catch(() => {})
  }
}

export function setWaitingSession(state: Omit<WaitingSession, 'updatedAt'>): void {
  const active = currentProviderInstance()
  const instance = state.providerInstanceId ?? (active?.provider === state.provider ? active.id : undefined)
    ?? runningSessions.get(runtimeKey(state.sessionId, runningSessions, state))?.providerInstanceId
  if (instance && instance !== state.provider) state = { ...state, providerInstanceId: instance }
  const key = runtimeKey(state.sessionId, waitingSessions, { ...state, providerInstanceId: instance })
  const observations = getSessionRuntimeState().waitingObservations!
  observations.delete(key)
  observations.set(key, { ...state, updatedAt: Date.now() })
  if (observations.size > 1000) observations.delete(observations.keys().next().value!)
  if (state.backgroundTasks.length === 0 && state.sessionCrons.length === 0) {
    waitingSessions.delete(key)
    return
  }
  waitingSessions.set(key, { ...state, updatedAt: Date.now() })
}

export function clearWaitingSession(sessionId: string): void {
  waitingSessions.delete(runtimeKey(sessionId, waitingSessions))
}

/** Latest authoritative background snapshot; foreground start/marker clearing is not proof of completion. */
export function readWaitingSessionObservation(sessionId: string, target?: RuntimeSessionTarget): WaitingSession | undefined {
  return getSessionRuntimeState().waitingObservations!.get(runtimeKey(sessionId, getSessionRuntimeState().waitingObservations!, target))
}

export function listWaitingSessions(): WaitingSession[] {
  return [...waitingSessions.values()]
}

export function getRunningSession(sessionId: string, target?: RuntimeSessionTarget): RunningSession | undefined {
  return runningSessions.get(runtimeKey(sessionId, runningSessions, target))
}

export function clearRunningSession(sessionId: string, requestId?: string): boolean {
  const running = runningSessions.get(runtimeKey(sessionId))
  if (!running) return false
  // A stale stream can finish after a retry/new turn has replaced its registry
  // entry. Request-scoped cleanup must never erase that newer turn.
  if (requestId && running.requestId !== requestId) return false
  return runningSessions.delete(runtimeKey(sessionId))
}

/**
 * Interrupt the running turn. Resolves to the provider's interrupt receipt
 * when it produces one (Claude interrupt_receipt_v1: `{ still_queued }` uuids
 * of queued async messages that survive the interrupt), undefined otherwise.
 */
export async function interruptRunningSession(sessionId: string, requestId?: string, cancelQueued = false, target?: RuntimeSessionTarget): Promise<unknown> {
  const running = getRunningSession(sessionId, target)
  if (running) {
    // A caller carrying a turn id is intentionally targeting one exact turn.
    // An uncorrelated/legacy registry entry is not safe to interrupt on its
    // behalf: it may already be the next turn after a cleanup race.
    if (requestId && running.requestId !== requestId) return undefined
    return await running.interrupt(cancelQueued)
  }

  if (!requestId) {
    throw new Error('No running session for this session')
  }

  const key = runtimeKey(sessionId, pendingInterrupts, target)
  const existing = pendingInterrupts.get(key)
  if (existing) clearTimeout(existing.timer)
  const timer = setTimeout(() => {
    const pending = pendingInterrupts.get(key)
    if (pending?.requestId === requestId) pendingInterrupts.delete(key)
  }, PENDING_INTERRUPT_TTL_MS)
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as { unref: () => void }).unref()
  }
  pendingInterrupts.set(key, { requestId, timer })
}

/**
 * Try to steer the session's in-flight turn with an extra user message.
 * `delivered: false` means no running turn or no steer primitive — the caller
 * should fall back to queueing the message for the next turn. `messageUuid` is
 * set when the provider stamps the delivered message (Claude), so clients can
 * correlate command_lifecycle frames and interrupt still_queued receipts.
 */
export async function steerRunningSession(sessionId: string, text: string, requestId?: string, target?: RuntimeSessionTarget): Promise<{ delivered: boolean; messageUuid?: string }> {
  const running = getRunningSession(sessionId, target)
  if (!running?.steer) return { delivered: false }
  if (requestId && running.requestId !== requestId) return { delivered: false }
  const result = await running.steer(text)
  return { delivered: true, messageUuid: typeof result === 'string' ? result : undefined }
}

function pruneSteerReceipts(now: number): void {
  for (const [key, receipt] of steerReceipts!) {
    if (receipt.settled && now - receipt.createdAt >= STEER_RECEIPT_TTL_MS) {
      steerReceipts!.delete(key)
    }
  }
}

function reserveSteerReceiptSlot(): boolean {
  if (steerReceipts!.size < MAX_STEER_RECEIPTS) return true
  for (const [key, receipt] of steerReceipts!) {
    if (!receipt.settled) continue
    steerReceipts!.delete(key)
    return true
  }
  return false
}

/**
 * Process-local exactly-once wrapper for a steering request. It retains both
 * in-flight and recently settled receipts so an HTTP retry after a lost
 * response observes the original result instead of invoking the provider a
 * second time. The request id is scoped to the session and exact turn/text.
 */
export function steerRunningSessionIdempotent(
  sessionId: string,
  text: string,
  turnRequestId: string | undefined,
  steerRequestId: string | undefined,
  target?: RuntimeSessionTarget,
): Promise<{ delivered: boolean; messageUuid?: string }> {
  if (!steerRequestId) return steerRunningSession(sessionId, text, turnRequestId, target)
  const now = Date.now()
  pruneSteerReceipts(now)
  const key = `${runtimeKey(sessionId, runningSessions, target)}\u0000${steerRequestId}`
  const existing = steerReceipts!.get(key)
  if (existing) {
    if (existing.text !== text || existing.turnRequestId !== turnRequestId) {
      return Promise.reject(new Error('steerRequestId was reused with a different payload'))
    }
    return existing.promise
  }
  if (!reserveSteerReceiptSlot()) {
    return Promise.reject(new Error('Steer receipt capacity reached; request was not delivered'))
  }

  const receipt: SteerReceipt = {
    text,
    turnRequestId,
    createdAt: now,
    settled: false,
    promise: Promise.resolve({ delivered: false }),
  }
  receipt.promise = steerRunningSession(sessionId, text, turnRequestId, target).finally(() => {
    receipt.settled = true
  })
  steerReceipts!.set(key, receipt)
  return receipt.promise
}

export function getSessionRuntimeDiagnostics(): { steerReceipts: number } {
  pruneSteerReceipts(Date.now())
  return { steerReceipts: steerReceipts!.size }
}

/**
 * Snapshot of whether a turn is currently running server-side for a session.
 * Used by clients to reattach to a live turn after navigating away or reloading
 * (the turn keeps running with detachOnClientAbort). `process-local`: only
 * reflects turns started in this process.
 */
export function getRunningSessionInfo(sessionId: string, target?: RuntimeSessionTarget): {
  running: boolean
  provider?: AgentProvider
  canSteer: boolean
  canInterrupt: boolean
  canBackground: boolean
} {
  const running = getRunningSession(sessionId, target)
  if (!running) return { running: false, canSteer: false, canInterrupt: false, canBackground: false }
  return {
    running: true,
    provider: running.provider,
    canSteer: typeof running.steer === 'function',
    canInterrupt: true,
    canBackground: typeof running.background === 'function',
  }
}

/**
 * Every session with a turn currently running in this process, for surfaces
 * that track liveness across sessions (reattach, attention inbox, fleet view).
 */
export function listRunningSessionRefs(): Array<{ sessionId: string; provider: AgentProvider; providerInstanceId?: string }> {
  return Array.from(runningSessions, ([key, running]) => ({ sessionId: key.startsWith('[') ? JSON.parse(key)[2] as string : key, provider: running.provider,
    ...(running.providerInstanceId ? { providerInstanceId: running.providerInstanceId } : {}) }))
}

export async function backgroundRunningSession(sessionId: string): Promise<boolean> {
  const running = runningSessions.get(runtimeKey(sessionId))
  if (!running) throw new Error('No running session for this session')
  if (!running.background) throw new Error(`${running.provider} sessions do not support backgrounding running tasks`)
  return Boolean(await running.background())
}
