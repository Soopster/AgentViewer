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

import { listPluginSurfaces, type PluginPopoverSurfaceId } from '../../lib/plugins/catalog'

type BuiltinPopoverWindowKind =
  | 'daily-summary' | 'coordination'
  | 'attention' | 'prompt-library' | 'playbooks' | 'handoff'
  | 'checkpoints' | 'file-history'
  | 'teammates' | 'desk'

/**
 * Built-in kinds plus every TUI plugin surface that is not also a side-panel
 * kind (those, like Git's `diff`, are surface kinds of their own); a plugin adds
 * none here.
 */
export type PopoverWindowKind = BuiltinPopoverWindowKind | PluginPopoverSurfaceId

export type PopoverWindowSpec = {
  title: string
  pin: 'session' | 'path' | null
  single: boolean
  keys: 'window' | 'capture'
  palette: string
}

const BUILTIN_POPOVER_WINDOWS: Record<BuiltinPopoverWindowKind, PopoverWindowSpec> = {
  'daily-summary': { title: '☰ Daily summary', pin: null, single: true, keys: 'window', palette: 'Daily summary in a window' },
  // The agent control center (⌃K a): one coordination store, so one view of it.
  coordination: { title: '◆ Control center', pin: null, single: true, keys: 'window', palette: 'Agent control center in a window' },
  attention: { title: '! Attention', pin: null, single: true, keys: 'window', palette: 'Attention inbox in a window' },
  'prompt-library': { title: '❝ Prompts', pin: null, single: true, keys: 'window', palette: 'Prompt library in a window' },
  playbooks: { title: '▦ Playbooks', pin: null, single: true, keys: 'window', palette: 'Playbook manager in a window' },
  handoff: { title: '⇢ Handoff brief', pin: 'session', single: false, keys: 'window', palette: 'Handoff brief in a window' },
  // Checkpoints are the repository's, not a session's.
  checkpoints: { title: '⟲ Checkpoints', pin: null, single: true, keys: 'window', palette: 'Checkpoints & review in a window' },
  'file-history': { title: '⌚ File history', pin: 'path', single: false, keys: 'window', palette: 'File history in a window' },
  // The interactive coordinator's store holds one conversation's team.
  teammates: { title: '◆ Teammates', pin: null, single: true, keys: 'window', palette: 'Teammates in a window' },
  // The desk's letters belong to its command line, as the editor's do to its buffer.
  desk: { title: '▣ Desk', pin: null, single: true, keys: 'capture', palette: 'Desk in a window' },
}

export const POPOVER_WINDOWS: Record<PopoverWindowKind, PopoverWindowSpec> = {
  ...Object.fromEntries(listPluginSurfaces('tui').filter(surface => surface.placements.includes('window') && !surface.placements.includes('panel')).map(surface => [surface.id, {
    title: surface.title, pin: surface.pin === 'cwd' ? null : surface.pin, single: surface.single, keys: surface.keys, palette: surface.windowLabel,
  } satisfies PopoverWindowSpec])) as Record<PluginPopoverSurfaceId, PopoverWindowSpec>,
  ...BUILTIN_POPOVER_WINDOWS,
}

export function isPopoverWindowKind(kind: string): kind is PopoverWindowKind {
  return Object.prototype.hasOwnProperty.call(POPOVER_WINDOWS, kind)
}

/** What a window is pinned to; absent for a window that follows nothing. */
export type SurfaceMeta = { cwd?: string; session?: string; path?: string }

/** Persisted metadata, with anything malformed dropped rather than trusted. */
export function readSurfaceMeta(value: unknown): Record<string, SurfaceMeta> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, SurfaceMeta> = {}
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue
    const { session, path, cwd } = entry as Record<string, unknown>
    const meta: SurfaceMeta = {}
    if (typeof session === 'string' && session) meta.session = session
    if (typeof path === 'string' && path) meta.path = path
    if (typeof cwd === 'string' && cwd) meta.cwd = cwd
    if (meta.session || meta.path || meta.cwd) result[id] = meta
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
