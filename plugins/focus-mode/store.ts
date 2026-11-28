// Focus Mode's client half, one per renderer process: the cached block, the
// delivery gate that holds what is not urgent while a block runs, the batched
// writes of what it held, and the digest when the block ends. The view, the
// widget and the slash command all read this one controller, so starting a
// block from any of them takes effect on the gate at once.
import { useSyncExternalStore } from 'react'
import { setDeliveryGate, type DeliveryItem } from '../../lib/plugins/deliveryGate'
import { focusActive, focusDigestTitle, type FocusHeldItem, type FocusService, type FocusState } from '../../lib/plugins/focusMode'

const POLL_MS = 15_000
const HOLD_FLUSH_MS = 400

export type FocusNotify = (title: string) => void

export type FocusController = ReturnType<typeof createFocusController>

let sequence = 0
const heldId = () => `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function createFocusController(service: FocusService, options: { now?: () => number; pollMs?: number } = {}) {
  const now = options.now ?? Date.now
  let state: FocusState | null = null
  let error: string | null = null
  let notify: FocusNotify | null = null
  /** The newest block end already announced (or seen at launch): never announced twice, never replayed. */
  let announcedEndedAt: number | null = null
  let baselined = false
  const listeners = new Set<() => void>()
  let pending: FocusHeldItem[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let expiryTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  type Snapshot = { state: FocusState | null; error: string | null; pendingCount: number }
  let snapshot: Snapshot = { state, error, pendingCount: 0 }
  const emit = () => { snapshot = { state, error, pendingCount: pending.length }; for (const listener of listeners) listener() }

  function adopt(next: FocusState) {
    state = next
    error = null
    const endedAt = next.last?.endedAt ?? null
    if (!baselined) { baselined = true; announcedEndedAt = endedAt }
    else if (endedAt && endedAt !== announcedEndedAt) {
      announcedEndedAt = endedAt
      notify?.(focusDigestTitle(next.last!.held.length))
    }
    scheduleExpiry()
    emit()
  }

  function scheduleExpiry() {
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null }
    if (!state?.active) return
    const wait = Math.max(0, state.active.endsAt - now()) + 50
    expiryTimer = setTimeout(() => { void flush().then(() => refresh()) }, Math.min(wait, 2 ** 31 - 1))
    ;(expiryTimer as { unref?: () => void }).unref?.()
  }

  async function refresh(signal?: AbortSignal) {
    try { adopt(await service.read(signal)) } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); emit() }
  }

  async function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    if (!pending.length) return
    const batch = pending
    pending = []
    try { await service.hold(batch) } catch (cause) {
      // Kept rather than dropped: a held notification that vanished is the one thing this must not do.
      pending = [...batch, ...pending]
      error = cause instanceof Error ? cause.message : String(cause)
    }
    emit()
  }

  /** The gate: true holds the item. Synchronous, so it answers from the cached block. */
  function gate(item: DeliveryItem): boolean {
    if (!focusActive(state, now())) return false
    pending.push({ id: heldId(), at: now(), channel: item.channel, title: item.title.slice(0, 300), ...(item.detail ? { detail: item.detail.slice(0, 1000) } : {}), ...(item.target ? { target: item.target } : {}), ...(item.source ? { source: item.source } : {}) })
    if (!flushTimer) { flushTimer = setTimeout(() => { void flush() }, HOLD_FLUSH_MS); (flushTimer as { unref?: () => void }).unref?.() }
    emit()
    return true
  }

  let releaseGate: (() => void) | null = null
  return {
    /** Install the gate and start polling; returns the teardown. */
    activate(onDigest: FocusNotify) {
      notify = onDigest
      releaseGate = setDeliveryGate(gate)
      void refresh()
      pollTimer = setInterval(() => { void refresh() }, options.pollMs ?? POLL_MS)
      ;(pollTimer as { unref?: () => void }).unref?.()
      return () => {
        releaseGate?.(); releaseGate = null; notify = null
        if (pollTimer) clearInterval(pollTimer)
        if (expiryTimer) clearTimeout(expiryTimer)
        pollTimer = null; expiryTimer = null
        void flush()
      }
    },
    gate,
    refresh,
    flush,
    async start(minutes: number) { adopt(await service.start(minutes)) },
    async end() { await flush(); adopt(await service.end()) },
    async clearDigest() { adopt(await service.clearDigest()) },
    /** Settle a block that ran out between polls (the observer's tick calls this). */
    tick() { if (state?.active && now() >= state.active.endsAt) void flush().then(() => refresh()) },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

const controllers = new WeakMap<FocusService, FocusController>()
let bound: FocusController | null = null

/** One controller per service object: the application module, the views and the commands share it. */
export function focusController(service: FocusService): FocusController {
  let controller = controllers.get(service)
  if (!controller) { controller = createFocusController(service); controllers.set(service, controller) }
  return controller
}

/** Set by the application module while it is active; what a slash command acts on. */
export const bindFocusController = (controller: FocusController | null) => { bound = controller }
export const boundFocusController = () => bound

export function useFocus(controller: FocusController | null) {
  return useSyncExternalStore(
    listener => controller ? controller.subscribe(listener) : () => {},
    () => controller?.getSnapshot() ?? EMPTY,
    () => controller?.getSnapshot() ?? EMPTY,
  )
}
const EMPTY = { state: null as FocusState | null, error: null as string | null, pendingCount: 0 }
