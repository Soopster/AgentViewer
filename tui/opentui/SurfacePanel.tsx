/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { TuiThemePalette } from '../theme'
import {
  RIGHT_PANEL_SURFACE_KINDS,
  surfaceKindDescription,
  surfaceKindLabel,
  surfaceKindShortcut,
  type RightPanelSurfaceKind,
} from '../../lib/rightPanel'
import { activeSurface, type SurfacePanelState, type TuiSurface } from './surfacePanelState'

export type SurfacePanelKey = {
  name: string
  ctrl: boolean
  shift: boolean
  sequence: string
}

type Props = {
  state: SurfacePanelState
  theme: TuiThemePalette
  width: number
  height: number
  availability: Readonly<Record<RightPanelSurfaceKind, boolean>>
  unavailableHints: Readonly<Partial<Record<RightPanelSurfaceKind, string>>>
  /** Running subagents; badges the Agents card. */
  liveAgentCount?: number
  focused: boolean
  /** Expanded: the panel has taken everything the reader's minimum leaves. */
  expanded?: boolean
  onOpenSurface: (kind: RightPanelSurfaceKind) => void
  onCloseSurface: (id: string) => void
  onCycleSurface: (delta: number) => void
  onBlur: () => void
  /** Clicking anywhere in the panel takes focus, like clicking a split pane. */
  onFocus: () => void
  onActivateSurface: (id: string) => void
  onKeyHandlerReady: (handler: (key: SurfacePanelKey) => void) => void
  /** Key handler of the surface currently mounted, when it has one. */
  surfaceKeyHandler: (key: SurfacePanelKey) => void
  renderSurface: (surface: TuiSurface, box: { width: number; height: number }) => ReactNode
}

function fitTerminalText(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width === 1) return '…'
  return `${text.slice(0, width - 1)}…`
}

const SURFACE_GLYPH: Record<RightPanelSurfaceKind, string> = {
  browser: '◍',
  terminal: '❯',
  files: '▤',
  diff: '±',
  'pull-request': '⑂',
  agents: '◆',
}

export function SurfacePanel({
  state,
  theme,
  width,
  height,
  availability,
  unavailableHints,
  liveAgentCount = 0,
  focused,
  expanded = false,
  onOpenSurface,
  onCloseSurface,
  onCycleSurface,
  onBlur,
  onFocus,
  onActivateSurface,
  onKeyHandlerReady,
  surfaceKeyHandler,
  renderSurface,
}: Props) {
  const active = activeSurface(state)
  // The launcher doubles as "add a tab": it shows automatically when nothing is
  // open, and ⌃T brings it back over an open surface so a second one can be
  // added without closing the first.
  const [adding, setAdding] = useState(false)
  const showLauncher = state.surfaces.length === 0 || adding
  const [highlight, setHighlight] = useState(0)

  const availableKinds = useMemo(
    () => RIGHT_PANEL_SURFACE_KINDS.filter((kind) => availability[kind]),
    [availability],
  )

  const handleKey = useCallback((key: SurfacePanelKey) => {
    // Panel-level chords first: they must work whichever surface is mounted, so
    // a surface can never trap the user inside the panel.
    if (key.name === 'escape') {
      // Escape backs out of the add-a-tab launcher before it leaves the panel,
      // so an accidental ⌃T does not also throw away the focus.
      if (adding && state.surfaces.length > 0) { setAdding(false); return }
      onBlur()
      return
    }
    if (key.ctrl && key.name === 'w' && active) { setAdding(false); onCloseSurface(active.id); return }
    // Cycling deliberately avoids Tab: every docked surface uses Tab for its own
    // panes (the file browser's listing/preview, the git and PR popovers' left/
    // right split), so Tab has to reach the surface untouched. ⌃N/⌃P move
    // between tabs and ⌃T adds one, matching the browser-tab chords.
    if (key.ctrl && key.name === 'n') { setAdding(false); onCycleSurface(1); return }
    if (key.ctrl && key.name === 'p') { setAdding(false); onCycleSurface(-1); return }
    if (key.ctrl && key.name === 't' && state.surfaces.length > 0) {
      setAdding((current) => !current)
      return
    }

    if (showLauncher) {
      const lower = key.sequence?.toLowerCase() ?? ''
      const picked = availableKinds.find((kind) => surfaceKindShortcut(kind).toLowerCase() === lower)
      if (picked) { setAdding(false); onOpenSurface(picked); return }
      if (key.name === 'down' || key.name === 'right') {
        setHighlight((index) => (index + 1) % Math.max(1, availableKinds.length))
        return
      }
      if (key.name === 'up' || key.name === 'left') {
        setHighlight((index) => (index - 1 + Math.max(1, availableKinds.length)) % Math.max(1, availableKinds.length))
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        const kind = availableKinds[highlight]
        if (kind) { setAdding(false); onOpenSurface(kind) }
        return
      }
      return
    }

    surfaceKeyHandler(key)
  }, [active, adding, availableKinds, highlight, onBlur, onCloseSurface, onCycleSurface, onOpenSurface, showLauncher, state.surfaces.length, surfaceKeyHandler])

  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const innerWidth = Math.max(10, width - 2)
  // Border (2) + tab strip (1) is the chrome the surface does not get.
  const surfaceHeight = Math.max(3, height - 3)

  return (
    <box
      width={width}
      height={height}
      border
      borderStyle="single"
      borderColor={focused ? theme.cyan : theme.border}
      backgroundColor={theme.surface}
      flexDirection="column"
      onMouseDown={(event: { button: number; stopPropagation?: () => void }) => {
        // Clicking the panel focuses it, the same gesture that focuses a split
        // pane — otherwise a click would land on a surface the keys skip. The
        // event stops here so the reader below does not immediately take it back.
        if (event.button !== 0) return
        event.stopPropagation?.()
        if (!focused) onFocus()
      }}
      title={expanded ? ' Panel · expanded ' : ' Panel '}
      titleColor={focused ? theme.cyan : theme.dim}
      titleAlignment="left"
    >
      <box height={1} flexDirection="row" paddingX={1} overflow="hidden">
        {state.surfaces.length === 0 ? (
          <text fg={theme.dim} wrapMode="none">{fitTerminalText('no surface open', innerWidth - 2)}</text>
        ) : (
          state.surfaces.map((surface) => {
            const selected = surface.id === active?.id
            return (
              <box key={surface.id} flexDirection="row" backgroundColor={selected ? theme.surface3 : undefined}>
                <box
                  onMouseDown={(event: { button: number }) => {
                    if (event.button !== 0) return
                    onFocus()
                    setAdding(false)
                    onActivateSurface(surface.id)
                  }}
                >
                  <text fg={selected ? theme.text : theme.dim} wrapMode="none">
                    {` ${SURFACE_GLYPH[surface.kind]} ${surfaceKindLabel(surface.kind)} `}
                  </text>
                </box>
                <box
                  onMouseDown={(event: { button: number }) => {
                    if (event.button !== 0) return
                    onFocus()
                    setAdding(false)
                    onCloseSurface(surface.id)
                  }}
                >
                  <text fg={theme.dim} wrapMode="none">{'× '}</text>
                </box>
              </box>
            )
          })
        )}
        {state.surfaces.length > 0 ? (
          <box
            onMouseDown={(event: { button: number }) => {
              if (event.button !== 0) return
              onFocus()
              setAdding((current) => !current)
            }}
          >
            <text fg={adding ? theme.cyan : theme.dim} wrapMode="none">{'  ⌃T +'}</text>
          </box>
        ) : null}
      </box>

      {showLauncher ? (
        <Launcher
          onPick={(kind) => { onFocus(); setAdding(false); onOpenSurface(kind) }}
          theme={theme}
          width={innerWidth}
          height={surfaceHeight}
          availability={availability}
          unavailableHints={unavailableHints}
          liveAgentCount={liveAgentCount}
          highlight={highlight}
          availableKinds={availableKinds}
        />
      ) : active ? (
        renderSurface(active, { width: innerWidth, height: surfaceHeight })
      ) : null}
    </box>
  )
}

// ─── Launcher ─────────────────────────────────────────────────────────────────

function Launcher({
  onPick,
  theme,
  width,
  height,
  availability,
  unavailableHints,
  liveAgentCount,
  highlight,
  availableKinds,
}: {
  onPick: (kind: RightPanelSurfaceKind) => void
  theme: TuiThemePalette
  width: number
  height: number
  availability: Readonly<Record<RightPanelSurfaceKind, boolean>>
  unavailableHints: Readonly<Partial<Record<RightPanelSurfaceKind, string>>>
  liveAgentCount: number
  highlight: number
  availableKinds: readonly RightPanelSurfaceKind[]
}) {
  // A terminal column is too narrow for the web's two-across card grid, so the
  // same six surfaces read as one list — shortcut, name, then the one-liner.
  const rowWidth = Math.max(8, width - 2)
  return (
    <box height={height} flexDirection="column" paddingX={1} paddingTop={1}>
      <text fg={theme.text} wrapMode="none">{fitTerminalText('Open a surface', rowWidth)}</text>
      <text fg={theme.dim} wrapMode="none">{fitTerminalText('Choose what to show in this panel.', rowWidth)}</text>
      <box height={1} />
      {RIGHT_PANEL_SURFACE_KINDS.map((kind) => {
        const available = availability[kind]
        const selected = available && availableKinds[highlight] === kind
        const badge = kind === 'agents' && liveAgentCount > 0 ? ` ●${liveAgentCount}` : ''
        const detail = available ? surfaceKindDescription(kind) : unavailableHints[kind] ?? 'Not available right now.'
        return (
          <box
            key={kind}
            flexDirection="column"
            marginBottom={1}
            onMouseDown={(event: { button: number }) => {
              if (event.button !== 0 || !available) return
              onPick(kind)
            }}
          >
            <box flexDirection="row" backgroundColor={selected ? theme.surface3 : undefined}>
              <text fg={available ? theme.cyan : theme.dim} wrapMode="none">{` ${surfaceKindShortcut(kind)} `}</text>
              <text fg={available ? theme.text : theme.dim} wrapMode="none">
                {fitTerminalText(`${SURFACE_GLYPH[kind]} ${surfaceKindLabel(kind)}${badge}`, rowWidth - 4)}
              </text>
            </box>
            <text fg={theme.dim} wrapMode="none">{fitTerminalText(`    ${detail}`, rowWidth)}</text>
          </box>
        )
      })}
      <box height={1} />
      <text fg={theme.dim} wrapMode="none">
        {fitTerminalText('⌃N/⌃P switch · ⌃T adds · ⌃W closes', rowWidth)}
      </text>
      <text fg={theme.dim} wrapMode="none">
        {fitTerminalText('= expands · esc leaves the panel', rowWidth)}
      </text>
    </box>
  )
}
