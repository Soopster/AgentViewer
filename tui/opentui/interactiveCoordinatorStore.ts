// Interactive Coordinator state for the conversation the reader is on, held
// outside the OpenTUI root.
//
// Same shape as `coordinatorStore.ts`, and for the same reason: the root is one
// very large component, so a coordinator refresh held in its `useState` would
// re-render the whole app — mounted transcript included — to repaint a panel.
// The panel subscribes here, and the root reads `isInteractiveCoordinatorOpen`
// imperatively from its key dispatcher without subscribing at all.
//
// The feed runs only while the panel is open. Unlike the coordinator rail this
// is deliberately NOT started from boot: reading it reaches
// lib/agentCoordination.ts, which imports the send path, and a surface the user
// may never open must not be what loads it.
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
  readonly pending: TuiSessionCoordinationRequest | null
}

const RECONCILE_MS = 5_000

const IDLE: InteractiveCoordinatorState = {
  open: false, session: null, data: null, loading: false, busy: false, error: null, pending: null,
}

let state: InteractiveCoordinatorState = IDLE
const listeners = new Set<() => void>()

function commit(next: Partial<InteractiveCoordinatorState>): void {
  state = { ...state, ...next }
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
  stopFeed?.()
  stopFeed = null
  state = IDLE
  for (const listener of listeners) listener()
}

let stopFeed: (() => void) | null = null

export function openInteractiveCoordinator(session: InteractiveCoordinatorSession): void {
  // Compared against the retained session, not a live one: a close keeps both
  // the session and its last read so reopening the same conversation paints
  // its roster immediately and refreshes underneath, rather than flashing empty.
  const sameSession = state.session?.sessionId === session.sessionId
    && state.session.provider === session.provider
  if (state.open && sameSession) return
  stopFeed?.()
  // A different conversation's roster must never show under this session's
  // heading, so a switch drops the previous read rather than reusing it.
  state = { ...IDLE, open: true, session, data: sameSession ? state.data : null, loading: !sameSession }
  for (const listener of listeners) listener()
  stopFeed = startFeed(session)
}

export function closeInteractiveCoordinator(): void {
  if (!state.open) return
  stopFeed?.()
  stopFeed = null
  commit({ open: false, loading: false, busy: false })
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
        const data = await readTuiSessionCoordinator(session.sessionId, session.provider)
          .catch(() => null)
        if (cancelled) return
        // A failed read leaves the last observation on screen: a blank roster
        // and an unreachable one must not look alike.
        if (data) commit({ data, loading: false })
        else commit({ loading: false })
      } while (queued && !cancelled)
    } finally {
      inFlight = false
    }
  }

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

/** Drop an unconfirmed request after the user has checked what it did. */
export function discardInteractiveCoordinatorAction(): void {
  if (!state.pending) return
  commit({ pending: null, error: null })
}

async function submit(
  session: InteractiveCoordinatorSession,
  request: TuiSessionCoordinationRequest,
): Promise<boolean> {
  commit({ busy: true, pending: request, error: null })
  try {
    const data = await sendTuiSessionCoordination(session.sessionId, session.provider, request)
    commit({ data, busy: false, pending: null, error: null, loading: false })
    return true
  } catch (error) {
    commit({ busy: false, error: error instanceof Error ? error.message : 'Request could not be confirmed' })
    return false
  }
}
