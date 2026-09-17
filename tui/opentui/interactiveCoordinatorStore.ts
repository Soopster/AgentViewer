// Interactive Coordinator state for the conversation the reader is on, held
// outside the OpenTUI root.
//
// Same shape as `coordinatorStore.ts`, and for the same reason: the root is one
// very large component, so a coordinator refresh held in its `useState` would
// re-render the whole app — mounted transcript included — to repaint a panel.
// The panel subscribes here, and the root reads `isInteractiveCoordinatorOpen`
// imperatively from its key dispatcher without subscribing at all.
//
// Feeds start when a conversation is selected or its panel opens. Active teams
// remain observed after navigation so background attention stays visible;
// ordinary chats release their feed when the reader leaves. No feed starts at
// boot without a selected conversation: reading reaches
// lib/agentCoordination.ts, which imports the send path, and a surface the user
// may never open must not be what loads it.
import { coordinatorAttentionCount } from '../../lib/coordinatorAttentionCount'
import { randomUUID } from 'node:crypto'
import type { AgentProvider } from '../../lib/types'
import type { CoordinatorInteractiveState } from '../../lib/coordinatorInteractiveState'
import { COORDINATOR_NOTIFICATION_DELAY_MS, coordinatorAttentionPriority, coordinatorSignals, newCoordinatorSignals, type CoordinatorSignal } from '../../lib/coordinatorSignals'
import { readCoordinatorReviewed, writeCoordinatorReviewed } from '../../lib/tui/coordinatorReviewed'
import { getConfiguredTuiTeammateNotifications, setConfiguredTuiTeammateNotifications, type TuiTeammateNotifications } from '../../lib/tuiState'
import { clearCoordinatorRequest, coordinatorRequestScope, PendingCoordinatorRequestError, readPendingCoordinatorRequest, reserveCoordinatorRequest } from '../../lib/tui/coordinatorRequests'
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
  readonly observationUnavailable: boolean
  readonly requestStorageError: string | null
  readonly error: string | null
  /**
   * An action whose outcome is unknown. It is kept verbatim — `requestId`
   * included — because the server reconciles a replay of the same key instead
   * of repeating the mutation, so retrying is safe and editing is not.
   */
  readonly reviewed: readonly string[]
  readonly pending: TuiSessionCoordinationRequest | null
  /** Global, not per conversation: where teammate alerts are delivered. */
  readonly notifications: TuiTeammateNotifications
}

const RECONCILE_MS = 5_000

const IDLE: InteractiveCoordinatorState = {
  open: false, session: null, data: null, loading: false, busy: false, error: null, pending: null, reviewed: [], observationUnavailable: false, requestStorageError: null, notifications: 'desktop',
}

let state: InteractiveCoordinatorState = IDLE
const retained = new Map<string, InteractiveCoordinatorState>()
const revisions = new Map<string, number>()
const sessionKey = (session: InteractiveCoordinatorSession) => coordinatorRequestScope(session.provider, session.sessionId)
const UNCONFIRMED = 'A previous submission is unconfirmed. Inspect the task history, then retry the same request.'
function restorePending(session: InteractiveCoordinatorSession): Partial<InteractiveCoordinatorState> {
  try {
    const pending = readPendingCoordinatorRequest(sessionKey(session))
    return { pending, error: pending ? UNCONFIRMED : null, requestStorageError: null }
  } catch (error) {
    const message = `Could not read unconfirmed Coordinator requests: ${error instanceof Error ? error.message : String(error)}`
    return { error: message, requestStorageError: message }
  }
}
function updateSession(session: InteractiveCoordinatorSession, next: Partial<InteractiveCoordinatorState>): void {
  const key = sessionKey(session)
  const current = state.session && sessionKey(state.session) === key
  const updated = { ...(current ? state : retained.get(key) ?? { ...IDLE, session }), ...next }
  retained.set(key, updated)
  if (current) commit(next)
  else for (const listener of listeners) listener()
  if (next.data) emitSignals(session, updated)
}

export type InteractiveCoordinatorNotification = {
  session: InteractiveCoordinatorSession
  signal: CoordinatorSignal
  /** The panel is open on this conversation, so the user may already see it. */
  viewing: boolean
}
const signalBaselines = new Map<string, Set<string>>()
const pendingNotifications = new Set<ReturnType<typeof setTimeout>>()
const notificationListeners = new Set<(event: InteractiveCoordinatorNotification) => void>()

/**
 * Transitions only: the first read of a conversation is a baseline, so opening
 * the TUI or selecting an old chat never replays what it already holds. The
 * listener owns suppression, because only the renderer knows terminal focus.
 */
export function subscribeInteractiveCoordinatorNotifications(listener: (event: InteractiveCoordinatorNotification) => void): () => void {
  notificationListeners.add(listener)
  return () => { notificationListeners.delete(listener) }
}

/**
 * Test seam: whether anything is listening for teammate alerts. The root's
 * subscription is the one link no pure test covers — delivery rules and store
 * emission are tested directly — and losing it is invisible in every frame.
 */
export function interactiveCoordinatorNotificationListeners(): number {
  return notificationListeners.size
}

function emitSignals(session: InteractiveCoordinatorSession, entry: InteractiveCoordinatorState): void {
  const key = sessionKey(session)
  const signals = coordinatorSignals(entry.data, entry.reviewed)
  const fresh = newCoordinatorSignals(signalBaselines.get(key) ?? null, signals)
  signalBaselines.set(key, new Set(signals.map(signal => signal.id)))
  for (const signal of fresh) {
    // Delivered only if the signal is still current when the delay elapses,
    // and `viewing` is judged then, not when it was first seen.
    const timer = setTimeout(() => {
      pendingNotifications.delete(timer)
      if (!signalBaselines.get(key)?.has(signal.id)) return
      const viewing = state.open && state.session !== null && sessionKey(state.session) === key
      for (const listener of notificationListeners) listener({ session, signal, viewing })
    }, COORDINATOR_NOTIFICATION_DELAY_MS)
    pendingNotifications.add(timer)
  }
}
function advanceRevision(session: InteractiveCoordinatorSession): void {
  const key = sessionKey(session)
  revisions.set(key, (revisions.get(key) ?? 0) + 1)
}
const listeners = new Set<() => void>()

let notifications: TuiTeammateNotifications = 'desktop'
let notificationsLoaded: Promise<void> | null = null
let notificationsChosen = false
/** Loaded once, on first use — reading preferences must not be a boot cost. */
function loadNotificationPreference(): void {
  notificationsLoaded ??= getConfiguredTuiTeammateNotifications()
    .then((mode) => { if (!notificationsChosen) { notifications = mode; commit({}) } })
    .catch(() => {})
}

export function getInteractiveCoordinatorNotifications(): TuiTeammateNotifications {
  return notifications
}

const NOTIFICATION_ORDER: readonly TuiTeammateNotifications[] = ['desktop', 'in-app', 'off']
/** Cycle desktop → in-app → off, persisting the choice. */
export function cycleInteractiveCoordinatorNotifications(): TuiTeammateNotifications {
  notificationsChosen = true
  notifications = NOTIFICATION_ORDER[(NOTIFICATION_ORDER.indexOf(notifications) + 1) % NOTIFICATION_ORDER.length]
  commit({})
  void setConfiguredTuiTeammateNotifications(notifications).catch(() => {})
  return notifications
}

function commit(next: Partial<InteractiveCoordinatorState>): void {
  state = { ...state, ...next, notifications }
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
  observers.clear()
  state = IDLE
  notifications = 'desktop'
  notificationsLoaded = null
  notificationsChosen = false
  retained.clear()
  revisions.clear()
  signalBaselines.clear()
  for (const timer of pendingNotifications) clearTimeout(timer)
  pendingNotifications.clear()
  for (const listener of listeners) listener()
}

const feeds = new Map<string, () => void>()
const refreshers = new Map<string, () => void>()
const observers = new Map<string, number>()

function ensureFeed(session: InteractiveCoordinatorSession): void {
  const key = sessionKey(session)
  if (!feeds.has(key)) feeds.set(key, startFeed(session))
  else refreshers.get(key)?.()
}

function releaseUnneededFeed(session: InteractiveCoordinatorSession): void {
  const key = sessionKey(session)
  const saved = retained.get(key)
  const run = saved?.data?.snapshot?.run
  const activeTeam = saved?.data?.interactive.enabled || (run && !['completed', 'failed', 'stopped'].includes(run.status))
  if (observers.has(key) || (state.open && state.session && sessionKey(state.session) === key)
    || saved?.loading || saved?.observationUnavailable || saved?.requestStorageError
    || saved?.busy || saved?.pending || activeTeam || coordinatorAttentionCount(saved?.data ?? null, saved?.reviewed) > 0) return
  feeds.get(key)?.()
  feeds.delete(key)
  refreshers.delete(key)
  retained.delete(key)
  revisions.delete(key)
  signalBaselines.delete(key)
}

/** Observe without opening the panel, changing focus, or sending any work. */
export function observeInteractiveCoordinator(session: InteractiveCoordinatorSession): () => void {
  loadNotificationPreference()
  const key = sessionKey(session)
  observers.set(key, (observers.get(key) ?? 0) + 1)
  if (!retained.has(key)) {
    retained.set(key, { ...IDLE, session, loading: true, reviewed: readCoordinatorReviewed(key), ...restorePending(session) })
    for (const listener of listeners) listener()
  }
  ensureFeed(session)
  let released = false
  return () => {
    if (released) return
    released = true
    const remaining = (observers.get(key) ?? 1) - 1
    if (remaining > 0) observers.set(key, remaining)
    else observers.delete(key)
    releaseUnneededFeed(session)
  }
}

export function openInteractiveCoordinator(session: InteractiveCoordinatorSession): void {
  loadNotificationPreference()
  // Compared against the retained session, not a live one: a close keeps both
  // the session and its last read so reopening the same conversation paints
  // its roster immediately and refreshes underneath, rather than flashing empty.
  const sameSession = state.session?.sessionId === session.sessionId
    && state.session.provider === session.provider
  if (state.open && sameSession) return
  // A different conversation's roster must never show under this session's
  // heading, so a switch drops the previous read rather than reusing it.
  const saved = retained.get(sessionKey(session))
  state = { ...(saved ?? { ...IDLE, reviewed: readCoordinatorReviewed(sessionKey(session)) }), ...(!saved?.busy ? restorePending(session) : {}), open: true, session, loading: !saved?.data, notifications }
  retained.set(sessionKey(session), state)
  for (const listener of listeners) listener()
  ensureFeed(session)
}

export function closeInteractiveCoordinator(): void {
  if (!state.open) return
  commit({ open: false })
  if (state.session) releaseUnneededFeed(state.session)
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
        const saved = retained.get(sessionKey(session))
        const requestError = saved?.requestStorageError ?? (saved?.pending ? saved.error : null)
        if (data) updateSession(session, { data, loading: false, observationUnavailable: false, error: requestError })
        else updateSession(session, { loading: false, observationUnavailable: true, error: requestError ?? 'Could not refresh teammate state; showing the last observation.' })
        releaseUnneededFeed(session)
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
  if (!state.open || !session || state.busy || state.pending) return false
  const next: TuiSessionCoordinationRequest = { ...request, cwd: request.cwd ?? session.cwd, requestId: randomUUID() }
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
  reviewInteractiveCoordinatorResults([id])
}

/** Batch form, for reading a teammate's transcript: every result it holds is reviewed. */
export function reviewInteractiveCoordinatorResults(ids: readonly string[]): void {
  if (!ids.length || ids.every(id => state.reviewed.includes(id))) return
  const reviewed = [...state.reviewed.filter(entry => !ids.includes(entry)), ...ids].slice(-500)
  commit({ reviewed: state.session ? writeCoordinatorReviewed(sessionKey(state.session), reviewed) : reviewed })
}

/** Drop an unconfirmed request after the user has checked what it did. */
export function discardInteractiveCoordinatorAction(): void {
  if (!state.pending || state.busy || !state.session) return
  try {
    clearCoordinatorRequest(sessionKey(state.session), state.pending.requestId)
    commit({ pending: null, ...restorePending(state.session) })
  } catch (error) {
    commit({ error: `Could not clear the saved request: ${error instanceof Error ? error.message : String(error)}` })
  }
}

async function submit(
  session: InteractiveCoordinatorSession,
  request: TuiSessionCoordinationRequest,
): Promise<boolean> {
  advanceRevision(session)
  updateSession(session, { busy: true, pending: request, error: null })
  try {
    reserveCoordinatorRequest(sessionKey(session), request)
    updateSession(session, { requestStorageError: null })
    const data = await sendTuiSessionCoordination(session.sessionId, session.provider, request)
    clearCoordinatorRequest(sessionKey(session), request.requestId)
    advanceRevision(session)
    updateSession(session, { data, busy: false, pending: null, error: null, loading: false, observationUnavailable: false, ...restorePending(session) })
    return true
  } catch (error) {
    advanceRevision(session)
    updateSession(session, { busy: false, ...(error instanceof PendingCoordinatorRequestError ? { pending: error.request } : {}), error: error instanceof Error ? error.message : 'Request could not be confirmed' })
    return false
  }
}

/**
 * Herdr keeps "blocked" and "done" apart in its indicator, and so does this:
 * an unreviewed result is worth knowing about but is not waiting on anyone, so
 * it must not read as urgent — or the urgent label stops meaning anything.
 */
export function getInteractiveCoordinatorAttention(): string {
  let total = 0
  let finished = 0
  for (const entry of retained.values()) {
    total += coordinatorAttentionCount(entry.data, entry.reviewed) + Number(Boolean(entry.pending && !entry.busy))
    finished += coordinatorSignals(entry.data, entry.reviewed).filter(signal => signal.kind === 'finished').length
  }
  const waiting = total - finished
  if (waiting > 0) return `! Teammates: ${waiting} need attention${finished ? ` · ${finished} finished` : ''}`
  return finished ? `✓ Teammates: ${finished} finished` : ''
}
export function openInteractiveCoordinatorAttention(): void {
  let target: InteractiveCoordinatorState | null = null
  let best = 0
  for (const entry of retained.values()) {
    if (!entry.session) continue
    const signals = coordinatorSignals(entry.data, entry.reviewed)
    // Attention the signals do not name (an unconfirmed lead delivery) still waits on the user.
    const unnamed = coordinatorAttentionCount(entry.data, entry.reviewed) > signals.length
    const priority = coordinatorAttentionPriority(signals, Boolean(entry.pending) || unnamed)
    if (priority > best) { best = priority; target = entry }
  }
  if (target?.session) openInteractiveCoordinator(target.session)
}
