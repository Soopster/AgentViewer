// Minimal in-TUI toast store — a Sonner-style observer (pub/sub), adapted from
// the pattern in msmps/opentui-ui's toast package and trimmed to what
// agent-viewer needs. This consolidates the old single-slot `notice` banner:
// toasts stack (up to MAX_TOASTS), each carries its own auto-dismiss timer, and
// the `<ToastOverlay>` renders them floating bottom-right. OS-level
// turn-complete notifications stay separate (those go through native OSC).
import { toBmpSafe } from './bmp'

export type ToastKind = 'default' | 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

export interface ToastOptions {
  durationMs?: number
}

type Listener = (toasts: Toast[]) => void

// At most this many toasts stack at once; the oldest is evicted (timer cleared).
const MAX_TOASTS = 4
const DEFAULT_DURATION_MS = 2000
const ERROR_DURATION_MS = 4500

let counter = 1
let current: Toast[] = []
const listeners = new Set<Listener>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit(): void {
  // `current` is replaced (never mutated) on every change, so subscribers can
  // rely on referential identity to skip work when nothing changed.
  for (const listener of listeners) listener(current)
}

function clearTimer(id: number): void {
  const handle = timers.get(id)
  if (handle != null) {
    clearTimeout(handle)
    timers.delete(id)
  }
}

// Current snapshot for useSyncExternalStore's getSnapshot. `current` is replaced
// (never mutated) on change, so the reference is stable while nothing changes.
export function getToasts(): Toast[] {
  return current
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function dismissToast(id: number): void {
  clearTimer(id)
  const next = current.filter((toast) => toast.id !== id)
  if (next.length === current.length) return
  current = next
  emit()
}

export function dismissAllToasts(): void {
  if (current.length === 0) return
  for (const handle of timers.values()) clearTimeout(handle)
  timers.clear()
  current = []
  emit()
}

function push(kind: ToastKind, message: string, options?: ToastOptions): number {
  const id = counter++
  // BMP-sanitize: toast text can include arbitrary error strings, and astral
  // glyphs truncate on Windows terminals (CLAUDE.md BMP-safe rule).
  const toast: Toast = { id, kind, message: toBmpSafe(message) }
  const next = [...current, toast]
  while (next.length > MAX_TOASTS) {
    const evicted = next.shift()
    if (evicted) clearTimer(evicted.id)
  }
  current = next
  emit()
  const duration = options?.durationMs ?? (kind === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS)
  if (duration > 0) {
    timers.set(id, setTimeout(() => dismissToast(id), duration))
  }
  return id
}

export const toast = {
  message: (message: string, options?: ToastOptions) => push('default', message, options),
  success: (message: string, options?: ToastOptions) => push('success', message, options),
  error: (message: string, options?: ToastOptions) => push('error', message, options),
  info: (message: string, options?: ToastOptions) => push('info', message, options),
  warning: (message: string, options?: ToastOptions) => push('warning', message, options),
}
