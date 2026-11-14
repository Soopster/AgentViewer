/** @jsxImportSource @opentui/react */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BoxRenderable } from '@opentui/core'
import { registerTabPaintOccluder } from '../../SessionTabConnection'
import type { PaletteCommand } from '../types'
import type { TuiThemePalette } from '../../../theme'
import { fitText } from '../../textLayout'
import { type PaletteRow } from '../types'
import { clamp } from '../util'
import { renderInlineTextSegments } from '../inlineText'
import { MODAL_CONTENT_Z_INDEX } from '../../layers'
import { ListScrollbar } from './ListScrollbar'

/** What the palette asks the root to do from the mouse. Stable callbacks. */
export type CommandPaletteMouse = {
  readonly select: (index: number) => void
  readonly run: (commandId: string) => void
  readonly close: () => void
}

type MouseLike = { button?: number; stopPropagation?: () => void; scroll?: { direction?: string } }
const WHEEL_ROWS = 3

export function CommandPaletteOverlay({ commandPaletteOpen, width, height, filteredCommands, paletteDisplayRows, commandPaletteIndex, commandPaletteBodyRows, commandPaletteTopOffset, theme, commandPaletteQuery, mouse }: {
  commandPaletteOpen: boolean
  width: number
  height: number
  filteredCommands: PaletteCommand[]
  paletteDisplayRows: PaletteRow[]
  commandPaletteIndex: number
  commandPaletteBodyRows: number
  commandPaletteTopOffset: 2 | 4
  theme: TuiThemePalette
  commandPaletteQuery: string
  mouse?: CommandPaletteMouse
}) {
  // The wheel scrolls the list without moving the selection; moving the
  // selection (keys, hover, a new query) puts the window back on it.
  // A selection made by hovering is already on screen, so it never moves the
  // window (the wheel moves rows under a still pointer, which hovers them).
  const [wheelStart, setWheelStart] = useState<number | null>(null)
  // The tab strip's connector is painted after the frame; without this it draws
  // through the panel's top rows wherever the panel sits over the strip.
  const panelRef = useRef<BoxRenderable | null>(null)
  useLayoutEffect(() => registerTabPaintOccluder(() => {
    const box = panelRef.current
    return box && !box.isDestroyed ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
  }), [])
  const hoveredIndex = useRef<number | null>(null)
  useEffect(() => {
    if (hoveredIndex.current === commandPaletteIndex) return
    setWheelStart(null)
  }, [commandPaletteIndex])
  useEffect(() => { hoveredIndex.current = null; setWheelStart(null) }, [commandPaletteQuery, commandPaletteOpen])
  if (!commandPaletteOpen) return null

  const paletteW = Math.min(width - 8, 76)
  const shortcutW = Math.max(8, Math.min(18, filteredCommands.reduce((longest, command) => Math.max(longest, command.key.length), 0)))
  const labelW = Math.max(12, paletteW - shortcutW - 5)
  // Keep the absolute overlay bounded with a deterministic row window.
  // Stable slot keys avoid stale terminal cells as the window moves.
  const selectedRowIndex = paletteDisplayRows.findIndex((row) => row.kind === 'cmd' && row.cmdIndex === commandPaletteIndex)
  const maxStart = Math.max(0, paletteDisplayRows.length - commandPaletteBodyRows)
  const followStart = clamp((selectedRowIndex === -1 ? 0 : selectedRowIndex) - Math.floor(commandPaletteBodyRows / 2), 0, maxStart)
  const startIdx = clamp(wheelStart ?? followStart, 0, maxStart)
  const visibleRows = paletteDisplayRows.slice(startIdx, startIdx + commandPaletteBodyRows)
  const hiddenAbove = startIdx
  const hiddenBelow = Math.max(0, paletteDisplayRows.length - (startIdx + commandPaletteBodyRows))
  const scrollBy = (delta: number) => setWheelStart(clamp(startIdx + delta, 0, maxStart))
  const positionHint = filteredCommands.length > 0
    ? `  ${Math.min(commandPaletteIndex + 1, filteredCommands.length)}/${filteredCommands.length}`
    : ''
  const left = Math.max(Math.floor((width - paletteW) / 2), 2)
  return (
    <>
      {mouse ? (
        // A press anywhere outside the palette closes it, as Esc does.
        <box position="absolute" top={0} left={0} width={width} height={height} zIndex={MODAL_CONTENT_Z_INDEX + 1}
          onMouseDown={(event: MouseLike) => { event.stopPropagation?.(); mouse.close() }} />
      ) : null}
      <box
        id="command-palette"
        ref={panelRef}
        position="absolute"
        top={commandPaletteTopOffset}
        left={left}
        width={paletteW}
        border
        borderStyle="single"
        borderColor={theme.border2}
        backgroundColor={theme.surface}
        zIndex={MODAL_CONTENT_Z_INDEX + 2}
        flexDirection="column"
        onMouseDown={(event: MouseLike) => event.stopPropagation?.()}
        onMouseScroll={(event: MouseLike) => {
          event.stopPropagation?.()
          scrollBy(event.scroll?.direction === 'up' ? -WHEEL_ROWS : WHEEL_ROWS)
        }}
      >
        <box paddingX={1} paddingTop={1} paddingBottom={1} backgroundColor={theme.surface2}>
          <text wrapMode="none" selectable={false}>
            {renderInlineTextSegments([
              { text: '> ', fg: theme.dim },
              { text: commandPaletteQuery || 'type to filter', fg: commandPaletteQuery ? theme.text : theme.dim },
              { text: '█', fg: theme.cyan },
              { text: '  j/k · wheel · ⏎ or click run · esc', fg: theme.dim },
              { text: positionHint, fg: theme.muted },
            ], paletteW - 4, theme.dim)}
          </text>
        </box>
        {hiddenAbove > 0 ? (
          <box id="command-palette-more-above" paddingX={1} onMouseDown={(event: MouseLike) => { event.stopPropagation?.(); if ((event.button ?? 0) === 0) scrollBy(-commandPaletteBodyRows) }}>
            <text fg={theme.dim} wrapMode="none" selectable={false}>{`▲ ${hiddenAbove} more`}</text>
          </box>
        ) : null}
        <box flexDirection="row">
          <box flexGrow={1} flexDirection="column">
            {filteredCommands.length === 0 ? (
              <box paddingX={1}>
                <text fg={theme.dim}>no matches</text>
              </box>
            ) : visibleRows.map((row, i) => {
              if (row.kind === 'header') {
                return (
                  <box key={`palette-row:${i}`} paddingX={1} backgroundColor={theme.surface2} flexDirection="row">
                    <text fg={theme.cyan} wrapMode="none" selectable={false}>{'┄ '}</text>
                    <text fg={theme.cyan} wrapMode="none" selectable={false}>{row.label.toUpperCase()}</text>
                  </box>
                )
              }
              const isSelected = row.cmdIndex === commandPaletteIndex
              return (
                <box
                  key={`palette-row:${i}`}
                  id={`command-palette-row:${row.cmd.id}`}
                  paddingX={1}
                  backgroundColor={isSelected ? theme.surface3 : theme.surface}
                  flexDirection="row"
                  onMouseOver={() => { if (!isSelected) { hoveredIndex.current = row.cmdIndex; mouse?.select(row.cmdIndex) } }}
                  onMouseDown={(event: MouseLike) => {
                    event.stopPropagation?.()
                    if ((event.button ?? 0) !== 0) return
                    hoveredIndex.current = row.cmdIndex
                    mouse?.select(row.cmdIndex)
                    mouse?.run(row.cmd.id)
                  }}
                >
                  <text fg={theme.cyan} wrapMode="none" selectable={false}>{isSelected ? '▎' : ' '}</text>
                  <box flexGrow={1}>
                    <text fg={isSelected ? theme.text : theme.muted} wrapMode="none" selectable={false}>
                      {fitText(row.cmd.label, labelW - 1)}
                    </text>
                  </box>
                  <box width={shortcutW} justifyContent="flex-end">
                    <text fg={isSelected ? theme.cyan : theme.dim} wrapMode="none" selectable={false}>
                      {fitText(row.cmd.key, shortcutW)}
                    </text>
                  </box>
                </box>
              )
            })}
          </box>
          <ListScrollbar id="command-palette-scrollbar" total={paletteDisplayRows.length} rows={visibleRows.length} start={startIdx} theme={theme} onJump={setWheelStart} />
        </box>
        {hiddenBelow > 0 ? (
          <box id="command-palette-more-below" paddingX={1} onMouseDown={(event: MouseLike) => { event.stopPropagation?.(); if ((event.button ?? 0) === 0) scrollBy(commandPaletteBodyRows) }}>
            <text fg={theme.dim} wrapMode="none" selectable={false}>{`▼ ${hiddenBelow} more`}</text>
          </box>
        ) : null}
      </box>
    </>
  )
}
