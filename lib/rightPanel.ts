/**
 * Right-hand surface panel: the set of auxiliary surfaces (browser, terminal,
 * files, diff, pull request, agents) that can be docked beside the transcript.
 *
 * This is a *presentation* layer only — every surface reuses the component that
 * already backs its full-screen overlay, so opening one here and opening one
 * from the command palette render the same thing in a different shell.
 *
 * Two surface kinds are multi-instance (you can watch two localhost ports, or
 * keep two shells); the rest are singletons because their content is derived
 * from the active project and a second copy would show the same bytes twice.
 */

export const RIGHT_PANEL_SURFACE_KINDS = [
  'browser',
  'terminal',
  'files',
  'diff',
  'pull-request',
  'agents',
] as const

export type RightPanelSurfaceKind = (typeof RIGHT_PANEL_SURFACE_KINDS)[number]

/**
 * Kinds that may have more than one open surface at a time — two localhost
 * ports, two shells, two directories. The rest stay singletons because their
 * content is derived entirely from the active project, so a second copy would
 * show the same bytes twice.
 */
const MULTI_INSTANCE_KINDS: ReadonlySet<RightPanelSurfaceKind> = new Set(['browser', 'terminal', 'files'])

export function isMultiInstanceSurface(kind: RightPanelSurfaceKind): boolean {
  return MULTI_INSTANCE_KINDS.has(kind)
}

export type RightPanelSurface = {
  id: string
  kind: RightPanelSurfaceKind
  /** Browser surfaces only: the URL the tab is pointed at, persisted across reloads. */
  url?: string
}

export type RightPanelState = {
  open: boolean
  /** Expanded: the panel takes the whole content area and the transcript hides. */
  expanded: boolean
  surfaces: RightPanelSurface[]
  activeId: string | null
  width: number
}

export const RIGHT_PANEL_MIN_WIDTH = 360
export const RIGHT_PANEL_DEFAULT_WIDTH = 560
/**
 * The transcript column keeps at least this much room. The viewport fraction
 * alone is not enough: the session sidebar sits outside this row, so on a
 * narrow window 30% of the viewport still left the composer overflowing.
 */
export const RIGHT_PANEL_SIBLING_MIN_WIDTH = 420
const RIGHT_PANEL_MAX_WIDTH_FRACTION = 0.7

export function rightPanelMaxWidth(viewportWidth: number, containerWidth?: number): number {
  const fractionCap = Math.floor(viewportWidth * RIGHT_PANEL_MAX_WIDTH_FRACTION)
  const containerCap = containerWidth === undefined
    ? Number.POSITIVE_INFINITY
    : Math.floor(containerWidth) - RIGHT_PANEL_SIBLING_MIN_WIDTH
  // Never below the panel's own minimum: when the row cannot fit both columns'
  // minimums the transcript yields, and an inverted max/min would resolve to
  // min and overwrite the user's stored width on the next drag.
  return Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(fractionCap, containerCap))
}

export const RIGHT_PANEL_STORAGE_KEY = 'agent-viewer:right-panel'

export const EMPTY_RIGHT_PANEL_STATE: RightPanelState = {
  open: false,
  expanded: false,
  surfaces: [],
  activeId: null,
  width: RIGHT_PANEL_DEFAULT_WIDTH,
}

function isSurfaceKind(value: unknown): value is RightPanelSurfaceKind {
  return typeof value === 'string' && (RIGHT_PANEL_SURFACE_KINDS as readonly string[]).includes(value)
}

/** Tolerant of anything in storage — a malformed blob reads as "no panel". */
export function parseRightPanelState(raw: string | null): RightPanelState {
  if (!raw) return EMPTY_RIGHT_PANEL_STATE
  try {
    const parsed = JSON.parse(raw) as Partial<RightPanelState> | null
    if (!parsed || typeof parsed !== 'object') return EMPTY_RIGHT_PANEL_STATE
    const surfaces: RightPanelSurface[] = Array.isArray(parsed.surfaces)
      ? parsed.surfaces.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return []
          const { id, kind, url } = entry as RightPanelSurface
          if (typeof id !== 'string' || !isSurfaceKind(kind)) return []
          return [{ id, kind, ...(typeof url === 'string' ? { url } : {}) }]
        })
      : []
    const activeId = typeof parsed.activeId === 'string' && surfaces.some((s) => s.id === parsed.activeId)
      ? parsed.activeId
      : surfaces[0]?.id ?? null
    return {
      open: parsed.open === true,
      expanded: parsed.expanded === true,
      surfaces,
      activeId,
      width: typeof parsed.width === 'number' && Number.isFinite(parsed.width)
        ? Math.max(RIGHT_PANEL_MIN_WIDTH, Math.round(parsed.width))
        : RIGHT_PANEL_DEFAULT_WIDTH,
    }
  } catch {
    return EMPTY_RIGHT_PANEL_STATE
  }
}

let surfaceCounter = 0

export function nextSurfaceId(kind: RightPanelSurfaceKind): string {
  if (!isMultiInstanceSurface(kind)) return kind
  surfaceCounter += 1
  return `${kind}:${Date.now().toString(36)}${surfaceCounter.toString(36)}`
}

export function surfaceKindLabel(kind: RightPanelSurfaceKind): string {
  switch (kind) {
    case 'browser': return 'Browser'
    case 'terminal': return 'Terminal'
    case 'files': return 'Files'
    case 'diff': return 'Diff'
    case 'pull-request': return 'Pull request'
    case 'agents': return 'Agents'
  }
}

/** Letter shortcut shown on the launcher card and honoured while it is visible. */
export function surfaceKindShortcut(kind: RightPanelSurfaceKind): string {
  switch (kind) {
    case 'browser': return 'B'
    case 'terminal': return 'T'
    case 'files': return 'F'
    case 'diff': return 'D'
    case 'pull-request': return 'P'
    case 'agents': return 'A'
  }
}

export function surfaceKindDescription(kind: RightPanelSurfaceKind): string {
  switch (kind) {
    case 'browser': return 'Open a local app or URL.'
    case 'terminal': return 'Start a shell in this workspace.'
    case 'files': return 'Browse and read workspace files.'
    case 'diff': return 'Review this repository’s changes.'
    case 'pull-request': return 'Open this branch’s pull request.'
    case 'agents': return 'Follow subagents and workflows.'
  }
}
