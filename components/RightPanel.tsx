'use client'

import { Bot, FileDiff, Files, GitPullRequest, Globe2, Maximize2, Minimize2, PanelRightClose, Plus, TerminalSquare, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  RIGHT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_SURFACE_KINDS,
  rightPanelMaxWidth,
  surfaceKindDescription,
  surfaceKindLabel,
  surfaceKindShortcut,
  type RightPanelSurface,
  type RightPanelSurfaceKind,
} from '@/lib/rightPanel'

/**
 * The docked right-hand panel: a tab strip over one auxiliary surface, with a
 * launcher when nothing is open.
 *
 * It only owns the shell — width, tabs, focus and the launcher. Every surface's
 * content comes back from `renderSurface`, which lets the page keep passing the
 * same props it already passes to the full-screen overlays. Inactive surfaces
 * stay mounted behind `display:none` so switching tabs never restarts a
 * terminal or reloads a page.
 */

const SURFACE_ICONS: Record<RightPanelSurfaceKind, typeof Globe2> = {
  browser: Globe2,
  terminal: TerminalSquare,
  files: Files,
  diff: FileDiff,
  'pull-request': GitPullRequest,
  agents: Bot,
}

/** Overlays that must win over the launcher's letter shortcuts. */
const SHORTCUT_BLOCKING_LAYERS = [
  '[cmdk-root]',
  '[role="dialog"]',
  '[data-slot="popover-content"]',
].join(',')

export type RightPanelProps = {
  surfaces: readonly RightPanelSurface[]
  activeId: string | null
  width: number
  /** Expanded: the panel takes the whole content area instead of a fixed width. */
  expanded: boolean
  availability: Readonly<Record<RightPanelSurfaceKind, boolean>>
  unavailableHints: Readonly<Partial<Record<RightPanelSurfaceKind, string>>>
  /** Running + waiting subagents; badges the Agents card and tab. */
  liveAgentCount?: number
  onOpenSurface: (kind: RightPanelSurfaceKind) => void
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onCloseAll: () => void
  onCollapse: () => void
  onToggleExpanded: () => void
  onWidthChange: (width: number) => void
  surfaceTitle: (surface: RightPanelSurface) => string
  renderSurface: (surface: RightPanelSurface) => ReactNode
}

export default function RightPanel(props: RightPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const width = useResizableWidth(hostRef, props.width, props.onWidthChange, !props.expanded)
  const active = props.surfaces.find((surface) => surface.id === props.activeId) ?? props.surfaces[0] ?? null

  return (
    <div
      ref={hostRef}
      data-right-panel=""
      data-right-panel-expanded={props.expanded ? 'true' : 'false'}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        height: '100vh',
        // Expanded the panel is the content area: it flexes instead of holding
        // a stored width, and the transcript column is not rendered beside it.
        ...(props.expanded ? { flex: 1 } : { flexShrink: 0, width }),
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg)',
      }}
    >
      {props.expanded ? null : (
        <ResizeHandle hostRef={hostRef} storedWidth={props.width} onWidthChange={props.onWidthChange} />
      )}
      <TabStrip {...props} />
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {props.surfaces.length === 0 ? (
          <Launcher {...props} />
        ) : (
          props.surfaces.map((surface) => (
            <div
              key={surface.id}
              style={{
                display: surface.id === active?.id ? 'flex' : 'none',
                flexDirection: 'column',
                flex: surface.id === active?.id ? 1 : undefined,
                minHeight: 0,
                minWidth: 0,
              }}
            >
              {props.renderSurface(surface)}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Tab strip ────────────────────────────────────────────────────────────────

function TabStrip(props: RightPanelProps) {
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!addOpen) return
    const onDown = (event: MouseEvent) => {
      if (!addRef.current?.contains(event.target as Node)) setAddOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [addOpen])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        height: 34,
        flexShrink: 0,
        padding: '0 6px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        // No `overflow: hidden` here — the add-a-surface menu is positioned
        // against this row and a clip would swallow it. The tab list below
        // does its own horizontal scrolling instead.
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 0, overflowX: 'auto' }}>
        {props.surfaces.map((surface) => {
          const Icon = SURFACE_ICONS[surface.kind]
          const selected = surface.id === props.activeId
          return (
            <div
              key={surface.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: 24,
                paddingLeft: 8,
                paddingRight: 4,
                borderRadius: 5,
                flexShrink: 0,
                maxWidth: 170,
                background: selected ? 'var(--surface-3)' : 'transparent',
                color: selected ? 'var(--text)' : 'var(--text-3)',
              }}
            >
              <button
                type="button"
                onClick={() => props.onActivate(surface.id)}
                title={props.surfaceTitle(surface)}
                className="av-hover-control"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0,
                  background: 'none',
                  border: 0,
                  padding: 0,
                  cursor: 'pointer',
                  color: 'inherit',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 11,
                }}
              >
                <Icon size={12} aria-hidden style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {props.surfaceTitle(surface)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => props.onClose(surface.id)}
                aria-label={`Close ${props.surfaceTitle(surface)}`}
                title="Close"
                className="av-hover-control"
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 16,
                  height: 16,
                  flexShrink: 0,
                  borderRadius: 4,
                  background: 'none',
                  border: 0,
                  cursor: 'pointer',
                  color: 'var(--text-3)',
                }}
              >
                <X size={11} aria-hidden />
              </button>
            </div>
          )
        })}
      </div>

      <div ref={addRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setAddOpen((open) => !open)}
          title="Open a surface"
          aria-label="Open a surface"
          className="av-hover-control"
          style={iconButtonStyle}
        >
          <Plus size={13} aria-hidden />
        </button>
        {addOpen ? (
          <div
            style={{
              position: 'absolute',
              top: 26,
              right: 0,
              zIndex: 120,
              minWidth: 190,
              padding: '5px 0',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
            }}
          >
            {RIGHT_PANEL_SURFACE_KINDS.map((kind) => {
              const Icon = SURFACE_ICONS[kind]
              const available = props.availability[kind]
              return (
                <button
                  key={kind}
                  type="button"
                  disabled={!available}
                  onClick={() => { props.onOpenSurface(kind); setAddOpen(false) }}
                  className="av-hover-control"
                  title={available ? undefined : props.unavailableHints[kind]}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '6px 12px',
                    background: 'transparent',
                    border: 0,
                    cursor: available ? 'pointer' : 'default',
                    opacity: available ? 1 : 0.4,
                    color: 'var(--text-2)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    textAlign: 'left',
                  }}
                >
                  <Icon size={13} aria-hidden />
                  <span style={{ flex: 1 }}>{surfaceKindLabel(kind)}</span>
                  <kbd style={kbdStyle}>{surfaceKindShortcut(kind)}</kbd>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={props.onToggleExpanded}
        title={props.expanded ? 'Restore panel width' : 'Expand panel'}
        aria-label={props.expanded ? 'Restore panel width' : 'Expand panel'}
        aria-pressed={props.expanded}
        className="av-hover-control"
        style={{ ...iconButtonStyle, color: props.expanded ? 'var(--cyan)' : 'var(--text-3)' }}
      >
        {props.expanded ? <Minimize2 size={12} aria-hidden /> : <Maximize2 size={12} aria-hidden />}
      </button>

      <button
        type="button"
        onClick={props.onCollapse}
        title="Hide panel"
        aria-label="Hide panel"
        className="av-hover-control"
        style={iconButtonStyle}
      >
        <PanelRightClose size={13} aria-hidden />
      </button>
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 24,
  height: 24,
  flexShrink: 0,
  borderRadius: 5,
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
  color: 'var(--text-3)',
}

const kbdStyle: React.CSSProperties = {
  padding: '1px 5px',
  borderRadius: 4,
  border: '1px solid var(--border)',
  background: 'var(--surface-3)',
  color: 'var(--text-3)',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 10,
}

// ─── Launcher ─────────────────────────────────────────────────────────────────

function Launcher(props: RightPanelProps) {
  const actions = useMemo(
    () => RIGHT_PANEL_SURFACE_KINDS.map((kind) => ({
      kind,
      label: surfaceKindLabel(kind),
      description: surfaceKindDescription(kind),
      shortcut: surfaceKindShortcut(kind),
      available: props.availability[kind],
      hint: props.unavailableHints[kind] ?? 'Not available right now.',
      badge: kind === 'agents' ? props.liveAgentCount ?? 0 : 0,
    })),
    [props.availability, props.unavailableHints, props.liveAgentCount],
  )

  const availableActions = useMemo(() => actions.filter((action) => action.available), [actions])
  const [highlight, setHighlight] = useState(-1)
  const highlightIndex = availableActions.length === 0 ? -1 : Math.min(highlight, availableActions.length - 1)

  // Letter shortcuts work while the launcher is *visible*, not only while it is
  // focused — focus moves around too easily (a stray click on the transcript)
  // to carry them. Capture phase so app-level handlers cannot swallow them
  // first; typing contexts and open dialogs are left alone.
  const shortcutRef = useRef(availableActions)
  useEffect(() => { shortcutRef.current = availableActions })
  const openSurface = props.onOpenSurface
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const action = shortcutRef.current.find((entry) => entry.shortcut.toLowerCase() === event.key.toLowerCase())
      if (!action) return
      if (document.querySelector(SHORTCUT_BLOCKING_LAYERS)) return
      const target = event.target
      if (target instanceof Element && isTypingContext(target)) return
      event.preventDefault()
      event.stopPropagation()
      openSurface(action.kind)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [openSurface])

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflowY: 'auto',
        padding: '24px 20px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Open a surface</h3>
          <p style={{ margin: '5px 0 0', fontSize: 11.5, color: 'var(--text-3)' }}>
            Choose what to show in the right panel.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {actions.map((action) => {
            const Icon = SURFACE_ICONS[action.kind]
            const highlighted = highlightIndex !== -1 && availableActions[highlightIndex]?.kind === action.kind
            const shell: React.CSSProperties = {
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              width: '100%',
              padding: 14,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: highlighted ? 'var(--surface-3)' : 'var(--surface)',
              textAlign: 'left',
            }
            const body = (
              <>
                <kbd style={{ ...kbdStyle, position: 'absolute', top: 11, right: 11 }}>{action.shortcut}</kbd>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 28 }}>
                  <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                    <Icon size={15} aria-hidden />
                    {action.badge > 0 ? (
                      <span
                        aria-hidden
                        style={{
                          position: 'absolute',
                          top: -6,
                          right: -8,
                          minWidth: 14,
                          height: 14,
                          padding: '0 4px',
                          display: 'grid',
                          placeItems: 'center',
                          borderRadius: 999,
                          background: 'var(--cyan)',
                          color: 'var(--bg)',
                          fontSize: 9,
                          fontWeight: 700,
                        }}
                      >
                        {action.badge}
                      </span>
                    ) : null}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{action.label}</span>
                </span>
                <span style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-3)' }}>
                  {action.available ? action.description : action.hint}
                </span>
              </>
            )
            return action.available ? (
              <button
                key={action.kind}
                type="button"
                className="av-hover-control"
                onClick={() => props.onOpenSurface(action.kind)}
                onMouseEnter={() => setHighlight(availableActions.findIndex((entry) => entry.kind === action.kind))}
                onMouseLeave={() => setHighlight(-1)}
                style={{ ...shell, cursor: 'pointer' }}
              >
                {body}
              </button>
            ) : (
              <div key={action.kind} style={{ ...shell, opacity: 0.4 }}>
                {body}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function isTypingContext(target: Element): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLElement && target.isContentEditable
}

// ─── Resize ───────────────────────────────────────────────────────────────────

function ResizeHandle({
  hostRef,
  storedWidth,
  onWidthChange,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>
  storedWidth: number
  onWidthChange: (width: number) => void
}) {
  const [dragging, setDragging] = useState(false)

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = hostRef.current?.getBoundingClientRect().width ?? storedWidth
    const parentWidth = hostRef.current?.parentElement?.clientWidth
    const max = rightPanelMaxWidth(window.innerWidth, parentWidth)
    setDragging(true)
    const move = (moveEvent: PointerEvent) => {
      // The handle sits on the panel's left edge, so dragging left widens it.
      const next = Math.round(startWidth - (moveEvent.clientX - startX))
      onWidthChange(Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(max, next)))
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [hostRef, onWidthChange, storedWidth])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize right panel"
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        top: 0,
        left: -3,
        width: 7,
        height: '100%',
        zIndex: 30,
        cursor: 'col-resize',
        background: dragging ? 'color-mix(in srgb, var(--cyan) 40%, transparent)' : 'transparent',
      }}
    />
  )
}

/**
 * Re-clamps the stored width against the live row: dragging the OS window
 * narrower (or expanding the session sidebar) must not leave the panel wider
 * than the row can afford, which would push the composer off-screen.
 */
function useResizableWidth(
  hostRef: React.RefObject<HTMLDivElement | null>,
  storedWidth: number,
  onWidthChange: (width: number) => void,
  enabled: boolean,
): number {
  const [max, setMax] = useState(() => rightPanelMaxWidth(typeof window === 'undefined' ? 1440 : window.innerWidth))

  useLayoutEffect(() => {
    // Expanded, the panel's own width *is* the row, so measuring it would ratchet
    // the stored width up to the full viewport and lose the user's setting.
    if (!enabled) return
    const parent = hostRef.current?.parentElement
    if (!parent) return
    // Measure before paint so the persisted width is clamped on the first
    // render rather than one observer tick later (the panel would flash wide).
    const measure = () => setMax(rightPanelMaxWidth(window.innerWidth, parent.clientWidth))
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(parent)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [enabled, hostRef])

  const clamped = Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(max, storedWidth))
  // Persist the clamp only when it is a real change, so a transient narrow
  // layout does not permanently shrink the remembered width by a pixel a frame.
  useEffect(() => {
    if (!enabled) return
    if (clamped !== storedWidth && Math.abs(clamped - storedWidth) > 1) onWidthChange(clamped)
  }, [clamped, enabled, storedWidth, onWidthChange])

  return clamped
}
