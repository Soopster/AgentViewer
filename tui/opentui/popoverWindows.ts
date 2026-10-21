// Popovers that can be broken out into windows. A popover is modal: it takes
// the screen and every key until it closes. As a window it is one of the
// layout's surfaces — tiled, tabbed, floated, saved with a layout, kept per
// workspace — and goes back to full screen when asked.
//
// Each kind says three things the host acts on:
//   pin     what the window keeps showing while the reader moves on: the
//           session it was opened for, a file path, or nothing (global views).
//   single  the popover's state is a singleton (a store, workspace-keyed state),
//           so it exists once — as a popover or as a window, never both.
//   keys    'window': routed like any surface window (after the global keys,
//           Esc back to the reader). 'capture': every key but the ⌃B prefix,
//           ahead of the global keys, as a shell in terminal mode is — for
//           views that are editors in their own right.

export type PopoverWindowKind = 'analytics' | 'daily-summary' | 'editor' | 'coordination'

export type PopoverWindowSpec = {
  title: string
  pin: 'session' | 'path' | null
  single: boolean
  keys: 'window' | 'capture'
  palette: string
}

export const POPOVER_WINDOWS: Record<PopoverWindowKind, PopoverWindowSpec> = {
  analytics: { title: '◔ Analytics', pin: 'session', single: false, keys: 'window', palette: 'Analytics in a window' },
  'daily-summary': { title: '☰ Daily summary', pin: null, single: true, keys: 'window', palette: 'Daily summary in a window' },
  editor: { title: '✎ Editor', pin: null, single: true, keys: 'capture', palette: 'Editor in a window' },
  // The agent control center (⌃K a): one coordination store, so one view of it.
  coordination: { title: '◆ Control center', pin: null, single: true, keys: 'window', palette: 'Agent control center in a window' },
}

export function isPopoverWindowKind(kind: string): kind is PopoverWindowKind {
  return Object.prototype.hasOwnProperty.call(POPOVER_WINDOWS, kind)
}

/** What a window is pinned to; absent for a window that follows nothing. */
export type SurfaceMeta = { session?: string; path?: string }

/** Persisted metadata, with anything malformed dropped rather than trusted. */
export function readSurfaceMeta(value: unknown): Record<string, SurfaceMeta> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, SurfaceMeta> = {}
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue
    const { session, path } = entry as Record<string, unknown>
    const meta: SurfaceMeta = {}
    if (typeof session === 'string' && session) meta.session = session
    if (typeof path === 'string' && path) meta.path = path
    if (meta.session || meta.path) result[id] = meta
  }
  return result
}

const kindOf = (id: string) => id.split('#')[0]!

/**
 * The window already showing `kind` for this pin, if any. A single kind has at
 * most one window whatever it was pinned to; a pinned kind has one per pin.
 */
export function findPopoverWindow(
  surfaces: readonly string[],
  meta: Readonly<Record<string, SurfaceMeta>>,
  kind: PopoverWindowKind,
  pin: SurfaceMeta,
): string | null {
  const spec = POPOVER_WINDOWS[kind]
  for (const id of surfaces) {
    if (kindOf(id) !== kind) continue
    if (spec.single || spec.pin === null) return id
    const own = meta[id] ?? {}
    if (spec.pin === 'session' ? own.session === pin.session : own.path === pin.path) return id
  }
  return null
}

/** The next free window id for `kind`: the kind itself, then `kind#2`, `kind#3`, … */
export function nextSurfaceId(kind: string, taken: ReadonlySet<string>): string {
  if (!taken.has(kind)) return kind
  let instance = 2
  while (taken.has(`${kind}#${instance}`)) instance += 1
  return `${kind}#${instance}`
}

/** The pin a popover opened now would take: the reader's session, a path, or nothing. */
export function pinFor(kind: PopoverWindowKind, reader: { session: string | null; path: string | null }): SurfaceMeta {
  const pin = POPOVER_WINDOWS[kind].pin
  if (pin === 'session' && reader.session) return { session: reader.session }
  if (pin === 'path' && reader.path) return { path: reader.path }
  return {}
}
