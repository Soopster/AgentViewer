// Interactive Coordinator state for the conversation the reader is on, held
// outside the OpenTUI root.
//
// Same shape as `coordinatorStore.ts`, and for the same reason: the root is one
// very large component, so a coordinator refresh held in its `useState` would
// re-render the whole app — mounted transcript included — to repaint a panel.
// The panel subscribes here, and the root reads `isInteractiveCoordinatorOpen`
// imperatively from its key dispatcher without subscribing at all.
//
// Feeds start when a session is first opened here and remain active after the
// panel closes so background attention stays visible. They do not start at boot:
// reading reaches
// lib/agentCoordination.ts, which imports the send path, and a surface the user
// may never open must not be what loads it.
import { coordinatorAttentionCount } from '../../lib/coordinatorAttentionCount'
import { randomUUID } from 'node:crypto'
import type { AgentProvider } from '../../lib/types'
import type { CoordinatorInteractiveState } from '../../lib/coordinatorInteractiveState'
import {
  readTuiSessionCoordinator,
  sendTuiSessionCoordination,
  subscribeTuiProtocolRunChanges,
  type TuiSessionCoordinationRequest,
} from '../../lib/tui/service'

export type InteractiveCoordinatorSession = {
  sessionId: string
  provider: AgentProvider
  cwd?: string
  title: string
}

export type InteractiveCoordinatorState = {
  /** Whether the panel is up. The session and its last read outlive a close. */
  readonly open: boolean
  readonly session: InteractiveCoordinatorSession | null
  readonly data: CoordinatorInteractiveState | null
  readonly loading: boolean
  readonly busy: boolean
  readonly error: string | null
  /**
   * An action whose outcome is unknown. It is kept verbatim — `requestId`
   * included — because the server reconciles a replay of the same key instead
   * of repeating the mutation, so retrying is safe and editing is not.
   */
  readonly reviewed: readonly string[]
  readonly pending: TuiSessionCoordinationRequest | null
}

const RECONCILE_MS = 5_000

const IDLE: InteractiveCoordinatorState = {
  open: false, session: null, data: null, loading: false, busy: false, error: null, pending: null, reviewed: [],
}

let state: InteractiveCoordinatorState = IDLE
const retained = new Map<string, InteractiveCoordinatorState>()
const revisions = new Map<string, number>()
const sessionKey = (session: InteractiveCoordinatorSession) => `${session.provider}:${session.sessionId}`
function updateSession(session: InteractiveCoordinatorSession, next: Partial<InteractiveCoordinatorState>): void {
  const key = sessionKey(session)
  const current = state.session && sessionKey(state.session) === key
  const updated = { ...(current ? state : retained.get(key) ?? { ...IDLE, session }), ...next }
  retained.set(key, updated)
  if (current) commit(next)
  else for (const listener of listeners) listener()
}
function advanceRevision(session: InteractiveCoordinatorSession): void {
  const key = sessionKey(session)
  revisions.set(key, (revisions.get(key) ?? 0) + 1)
}
const listeners = new Set<() => void>()

function commit(next: Partial<InteractiveCoordinatorState>): void {
  state = { ...state, ...next }
  if (state.session) retained.set(sessionKey(state.session), state)
  for (const listener of listeners) listener()
}

export function getInteractiveCoordinatorState(): InteractiveCoordinatorState {
  return state
}

export function subscribeInteractiveCoordinator(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Imperative read for the root's key dispatcher, which must not subscribe. */
export function isInteractiveCoordinatorOpen(): boolean {
  return state.open
}

/** Reset for tests; the app opens and closes the panel instead. */
export function resetInteractiveCoordinatorStore(): void {
  for (const stop of feeds.values()) stop()
  feeds.clear()
  refreshers.clear()
  state = IDLE
  retained.clear()
  revisions.clear()
  for (const listener of listeners) listener()
}

const feeds = new Map<string, () => void>()
const refreshers = new Map<string, () => void>()

export function openInteractiveCoordinator(session: InteractiveCoordinatorSession): void {
  // Compared against the retained session, not a live one: a close keeps both
  // the session and its last read so reopening the same conversation paints
  // its roster immediately and refreshes underneath, rather than flashing empty.
  const sameSession = state.session?.sessionId === session.sessionId
    && state.session.provider === session.provider
  if (state.open && sameSession) return
  // A different conversation's roster must never show under this session's
  // heading, so a switch drops the previous read rather than reusing it.
  const saved = retained.get(sessionKey(session))
  state = { ...(saved ?? IDLE), open: true, session, loading: !saved?.data }
  for (const listener of listeners) listener()
  if (!feeds.has(sessionKey(session))) feeds.set(sessionKey(session), startFeed(session))
  else refreshers.get(sessionKey(session))?.()
}

export function closeInteractiveCoordinator(): void {
  if (!state.open) return
  commit({ open: false, loading: false })
}

function startFeed(session: InteractiveCoordinatorSession): () => void {
  let cancelled = false
  let inFlight = false
  let queued = false

  const refresh = async () => {
    if (cancelled) return
    if (inFlight) { queued = true; return }
    inFlight = true
    try {
      do {
        queued = false
        const revision = revisions.get(sessionKey(session)) ?? 0
        const data = await readTuiSessionCoordinator(session.sessionId, session.provider)
          .catch(() => null)
        if (cancelled) return
        // A failed read leaves the last observation on screen: a blank roster
        // and an unreachable one must not look alike.
        if (revision !== (revisions.get(sessionKey(session)) ?? 0) || retained.get(sessionKey(session))?.busy) continue
        if (data) updateSession(session, { data, loading: false, error: retained.get(sessionKey(session))?.pending ? retained.get(sessionKey(session))?.error : null })
        else updateSession(session, { loading: false, error: retained.get(sessionKey(session))?.pending ? retained.get(sessionKey(session))?.error : 'Could not refresh teammate state; showing the last observation.' })
      } while (queued && !cancelled)
    } finally {
      inFlight = false
    }
  }

  refreshers.set(sessionKey(session), () => { void refresh() })
  void refresh()
  const unsubscribe = subscribeTuiProtocolRunChanges(() => { void refresh() })
  // Pushed run changes cover the ledger; the poll also catches the live-turn
  // registry and delivery state, which publish no run change of their own.
  const timer = setInterval(() => { void refresh() }, RECONCILE_MS)
  return () => {
    cancelled = true
    unsubscribe?.()
    clearInterval(timer)
  }
}

/**
 * Submit a Coordinator action. A failure keeps the request as `pending` so the
 * caller can retry it under the same idempotency key; until it is retried or
 * explicitly discarded, no new action may start — a second mutation while the
 * first is unresolved is the one thing the key cannot protect against.
 */
export async function runInteractiveCoordinatorAction(
  request: Omit<TuiSessionCoordinationRequest, 'requestId'>,
): Promise<boolean> {
  const session = state.session
  if (!state.open || !session || state.busy) return false
  const next: TuiSessionCoordinationRequest = state.pending
    ?? { ...request, cwd: request.cwd ?? session.cwd, requestId: randomUUID() }
  return submit(session, next)
}

/** Replay the unconfirmed request verbatim, reconciling it server-side. */
export async function retryInteractiveCoordinatorAction(): Promise<boolean> {
  const session = state.session
  if (!state.open || !session || state.busy || !state.pending) return false
  return submit(session, state.pending)
}

/** Review markers affect presentation only; they never acknowledge agent mail. */
export function reviewInteractiveCoordinatorResult(id: string): void {
  commit({ reviewed: [...state.reviewed.filter(entry => entry !== id), id].slice(-500) })
}

/** Drop an unconfirmed request after the user has checked what it did. */
export function discardInteractiveCoordinatorAction(): void {
  if (!state.pending || state.busy) return
  commit({ pending: null, error: null })
}

async function submit(
  session: InteractiveCoordinatorSession,
  request: TuiSessionCoordinationRequest,
): Promise<boolean> {
  advanceRevision(session)
  updateSession(session, { busy: true, pending: request, error: null })
  try {
    const data = await sendTuiSessionCoordination(session.sessionId, session.provider, request)
    advanceRevision(session)
    updateSession(session, { data, busy: false, pending: null, error: null, loading: false })
    return true
  } catch (error) {
    advanceRevision(session)
    updateSession(session, { busy: false, error: error instanceof Error ? error.message : 'Request could not be confirmed' })
    return false
  }
}

export function getInteractiveCoordinatorAttention(): string {
  let total = 0
  for (const entry of retained.values()) total += coordinatorAttentionCount(entry.data, entry.reviewed) + Number(Boolean(entry.pending && !entry.busy))
  return total ? `! Teammates: ${total} need attention` : ''
}
export function openInteractiveCoordinatorAttention(): void {
  const target = [...retained.values()].find(entry => entry.session && (coordinatorAttentionCount(entry.data, entry.reviewed) > 0 || entry.pending))
  if (target?.session) openInteractiveCoordinator(target.session)
}
