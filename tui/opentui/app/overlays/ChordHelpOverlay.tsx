/** @jsxImportSource @opentui/react */
// The ⌃B / ⌃K help panel, with the command palette's affordances: a selected
// entry (↑↓/j/k, PgUp/PgDn, Home/End, or hovering), ⏎ or a click to run it, the
// wheel to scroll, typing to filter, and a press outside to close.
//
// Two modes. Opened with `?` (dismissOnKey) it owns the keyboard like the
// palette. Revealed by hesitating on a prefix, its keys still belong to the
// pending chord — so there the mouse is how to use it as a palette.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BoxRenderable } from '@opentui/core'
import { registerTabPaintOccluder } from '../../SessionTabConnection'
import type { Toast } from '../../toastStore'
import type { TuiThemePalette } from '../../../theme'
import { toastExtraRows, toastStackTop } from '../../ToastOverlay'
import { fitText } from '../../textLayout'
import { chordHelpKeyWidth, chordHelpRows, filterChordHelpRows, SPLIT_CHORD_MAP, type ChordHelpRow, type ChordHelpState } from '../../chordHelp'
import { RUNNING_INSIDE_TMUX } from '../commands'
import { MODAL_CONTENT_Z_INDEX } from '../../layers'
import { renderInlineTextSegments } from '../inlineText'
import { clamp } from '../util'
import { ListScrollbar } from './ListScrollbar'

/** What the panel asks the root to do from the mouse. Stable callbacks. */
export type ChordHelpMouse = {
  readonly select: (index: number) => void
  readonly run: (row: ChordHelpRow) => void
  readonly close: () => void
}

/** The rows on show and the runnable entries the selection indexes, for the overlay and the key handler alike. */
export function chordHelpView(state: ChordHelpState): { rows: ChordHelpRow[]; entries: ChordHelpRow[]; selected: ChordHelpRow | null; index: number } {
  const rows = filterChordHelpRows(chordHelpRows(state.map), state.query ?? '')
  const entries = rows.filter(row => row.keys !== null && row.runnable)
  const index = entries.length ? clamp(state.index ?? 0, 0, entries.length - 1) : 0
  return { rows, entries, selected: entries[index] ?? null, index }
}

type MouseLike = { button?: number; stopPropagation?: () => void; scroll?: { direction?: string } }
const WHEEL_ROWS = 3

export function ChordHelpOverlay({ chordHelp, width, height, areaHeight, composerDockHeight, composerStatusBlockHeight, toasts, theme, mouse }: {
  chordHelp: ChordHelpState | null
  width: number
  height: number
  /** The main area the panel is drawn in (and clipped to): the rows between the spaces bar and the composer. */
  areaHeight: number
  composerDockHeight: number
  composerStatusBlockHeight: number
  toasts: Toast[]
  theme: TuiThemePalette
  mouse?: ChordHelpMouse
}) {
  const [wheelStart, setWheelStart] = useState<number | null>(null)
  // The tab strip's connector is painted after the frame; without this it draws
  // through the panel's top rows wherever the panel sits over the strip.
  const panelRef = useRef<BoxRenderable | null>(null)
  useLayoutEffect(() => registerTabPaintOccluder(() => {
    const box = panelRef.current
    return box && !box.isDestroyed ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
  }), [])
  const hovered = useRef<number | null>(null)
  const index = chordHelp?.index ?? 0
  useEffect(() => { if (hovered.current !== index) setWheelStart(null) }, [index])
  useEffect(() => { hovered.current = null; setWheelStart(null) }, [chordHelp?.map, chordHelp?.query, chordHelp === null])
  if (!chordHelp) return null

  const map = chordHelp.map
  const view = chordHelpView(chordHelp)
  const keysW = chordHelpKeyWidth(map)
  // Wide enough for the longest description (the ⌃B table's run long): the
  // selection marker, the key gutter, a gap, the label and the scrollbar.
  const longestLabel = view.rows.reduce((widest, row) => Math.max(widest, row.keys === null ? 0 : row.label.length), 0)
  const overlayW = Math.min(width - 4, Math.max(keysW + longestLabel + 9, 56))
  const labelW = overlayW - keysW - 8
  const overlayTop = 2
  // Two borders, the title row and the footer, plus the filter row (with its padding) when opened with `?`.
  const overlayChromeRows = 4 + (chordHelp.dismissOnKey ? 3 : 0)
  // In the area's coordinates: rows above it (the spaces bar) are not ours to count.
  // A toast draws over the panel's last row (how to close it), so end above the stack.
  const areaOffset = Math.max(0, height - composerDockHeight - composerStatusBlockHeight - areaHeight)
  const panelBottom = Math.min(
    areaHeight - 1,
    toasts.length > 0 ? toastStackTop(toasts.length, height, toastExtraRows(toasts.map(item => item.message), width)) - areaOffset : areaHeight,
  )
  const bodyRows = Math.max(Math.min(view.rows.length, panelBottom - overlayTop - overlayChromeRows), 3)
  const selectedRow = view.selected ? view.rows.indexOf(view.selected) : 0
  const maxStart = Math.max(0, view.rows.length - bodyRows)
  const followStart = clamp(selectedRow - Math.floor(bodyRows / 2), 0, maxStart)
  const startIdx = clamp(wheelStart ?? followStart, 0, maxStart)
  const visible = view.rows.slice(startIdx, startIdx + bodyRows)
  const hiddenBelow = Math.max(0, view.rows.length - startIdx - bodyRows)
  const scrollBy = (delta: number) => setWheelStart(clamp(startIdx + delta, 0, maxStart))
  const footer = chordHelp.dismissOnKey
    ? `${startIdx > 0 ? `▲ ${startIdx}  ` : ''}${hiddenBelow > 0 ? `▼ ${hiddenBelow}  ` : ''}⏎ or click runs · esc closes`
    : `${startIdx > 0 ? `▲ ${startIdx}  ` : ''}${hiddenBelow > 0 ? `▼ ${hiddenBelow}  ` : ''}press a key · or click a row`
  return (
    <>
      {mouse ? (
        <box position="absolute" top={0} left={0} width={width} height={height} zIndex={MODAL_CONTENT_Z_INDEX + 1}
          onMouseDown={(event: MouseLike) => { event.stopPropagation?.(); mouse.close() }} />
      ) : null}
      <box
        id="chord-help"
        ref={panelRef}
        position="absolute"
        top={overlayTop}
        left={Math.max(Math.floor((width - overlayW) / 2), 2)}
        width={overlayW}
        border
        borderStyle="single"
        borderColor={theme.amber}
        backgroundColor={theme.surface}
        // Above every piece of chrome: it is a reference card over all of it.
        zIndex={MODAL_CONTENT_Z_INDEX + 2}
        flexDirection="column"
        onMouseDown={(event: MouseLike) => event.stopPropagation?.()}
        onMouseScroll={(event: MouseLike) => { event.stopPropagation?.(); scrollBy(event.scroll?.direction === 'up' ? -WHEEL_ROWS : WHEEL_ROWS) }}
      >
        <box paddingX={1} backgroundColor={theme.surface2} flexDirection="row">
          <box flexGrow={1}>
            <text fg={theme.amber} wrapMode="none" selectable={false}>{map.title}</text>
          </box>
          <text fg={theme.dim} wrapMode="none" selectable={false}>
            {map === SPLIT_CHORD_MAP && RUNNING_INSIDE_TMUX ? 'tmux owns ⌃B — use ?' : `prefix ${map.prefix}`}
          </text>
        </box>
        {chordHelp.dismissOnKey ? (
          <box paddingX={1} paddingTop={1} paddingBottom={1} backgroundColor={theme.surface2}>
            <text wrapMode="none" selectable={false}>
              {renderInlineTextSegments([
                { text: '> ', fg: theme.dim },
                { text: chordHelp.query || 'type to filter', fg: chordHelp.query ? theme.text : theme.dim },
                { text: '█', fg: theme.cyan },
                { text: view.entries.length ? `  ${view.index + 1}/${view.entries.length}` : '', fg: theme.muted },
                { text: '  j/k move', fg: theme.dim },
              ], overlayW - 4, theme.dim)}
            </text>
          </box>
        ) : null}
        <box flexDirection="row">
          <box flexGrow={1} flexDirection="column">
            {view.rows.length === 0 ? (
              <box paddingX={1}><text fg={theme.dim}>no matches</text></box>
            ) : visible.map((row, slot) => {
              if (row.keys === null) {
                return (
                  <box key={`chord-row:${slot}`} paddingX={1} backgroundColor={theme.surface2} flexDirection="row">
                    <text fg={theme.cyan} wrapMode="none" selectable={false}>{`┄ ${row.label.toUpperCase()}`}</text>
                  </box>
                )
              }
              const entryIndex = row.runnable ? view.entries.indexOf(row) : -1
              const isSelected = row === view.selected
              return (
                <box
                  key={`chord-row:${slot}`}
                  id={`chord-help-row:${row.id}`}
                  paddingX={1}
                  flexDirection="row"
                  backgroundColor={isSelected ? theme.surface3 : theme.surface}
                  onMouseOver={() => { if (entryIndex >= 0 && !isSelected) { hovered.current = entryIndex; mouse?.select(entryIndex) } }}
                  onMouseDown={(event: MouseLike) => {
                    event.stopPropagation?.()
                    if ((event.button ?? 0) !== 0 || entryIndex < 0) return
                    mouse?.run(row)
                  }}
                >
                  <text fg={theme.cyan} wrapMode="none" selectable={false}>{isSelected ? '▎' : ' '}</text>
                  <box width={keysW}>
                    <text fg={row.runnable ? theme.amber : theme.dim} wrapMode="none" selectable={false}>{fitText(row.keys, keysW)}</text>
                  </box>
                  <box flexGrow={1} paddingLeft={2}>
                    <text fg={isSelected ? theme.text : row.runnable ? theme.muted : theme.dim} wrapMode="none" selectable={false}>{fitText(row.label, labelW)}</text>
                  </box>
                </box>
              )
            })}
          </box>
          <ListScrollbar id="chord-help-scrollbar" total={view.rows.length} rows={visible.length} start={startIdx} theme={theme} onJump={setWheelStart} />
        </box>
        <box paddingX={1} backgroundColor={theme.surface2}>
          <text fg={theme.dim} wrapMode="none" selectable={false}>{fitText(footer, overlayW - 4)}</text>
        </box>
      </box>
    </>
  )
}
