/** @jsxImportSource @opentui/react */
import type { PaletteCommand } from '../types'
import type { TuiThemePalette } from '../../../theme'
import { fitText } from '../../textLayout'
import { type PaletteRow } from '../types'
import { clamp } from '../util'
import { renderInlineTextSegments } from '../inlineText'

export function CommandPaletteOverlay({ commandPaletteOpen, width, filteredCommands, paletteDisplayRows, commandPaletteIndex, commandPaletteBodyRows, commandPaletteTopOffset, theme, commandPaletteQuery }: {
  commandPaletteOpen: boolean
  width: number
  filteredCommands: PaletteCommand[]
  paletteDisplayRows: PaletteRow[]
  commandPaletteIndex: number
  commandPaletteBodyRows: number
  commandPaletteTopOffset: 2 | 4
  theme: TuiThemePalette
  commandPaletteQuery: string
}) {
  return (
    commandPaletteOpen ? (() => {
          const paletteW = Math.min(width - 8, 76)
          const shortcutW = Math.max(8, Math.min(18, filteredCommands.reduce(
            (longest, command) => Math.max(longest, command.key.length),
            0,
          )))
          const labelW = Math.max(12, paletteW - shortcutW - 5)
          // Keep the absolute overlay bounded with a deterministic row window.
          // Stable slot keys avoid stale terminal cells as the window moves.
          const selectedRowIndex = paletteDisplayRows.findIndex((row) => row.kind === 'cmd' && row.cmdIndex === commandPaletteIndex)
          const maxStart = Math.max(0, paletteDisplayRows.length - commandPaletteBodyRows)
          const startIdx = clamp((selectedRowIndex === -1 ? 0 : selectedRowIndex) - Math.floor(commandPaletteBodyRows / 2), 0, maxStart)
          const visibleRows = paletteDisplayRows.slice(startIdx, startIdx + commandPaletteBodyRows)
          const hiddenAbove = startIdx
          const hiddenBelow = Math.max(0, paletteDisplayRows.length - (startIdx + commandPaletteBodyRows))
          const positionHint = filteredCommands.length > 0
            ? `  ${Math.min(commandPaletteIndex + 1, filteredCommands.length)}/${filteredCommands.length}`
            : ''
          return (
            <box
              position="absolute"
              top={commandPaletteTopOffset}
              left={Math.max(Math.floor((width - paletteW) / 2), 2)}
              width={paletteW}
              border
              borderStyle="single"
              borderColor={theme.border2}
              backgroundColor={theme.surface}
              zIndex={30}
              flexDirection="column"
            >
              <box paddingX={1} paddingTop={1} paddingBottom={1} backgroundColor={theme.surface2}>
                <text wrapMode="none">
                  {renderInlineTextSegments([
                    { text: '> ', fg: theme.dim },
                    { text: commandPaletteQuery || 'type to filter', fg: commandPaletteQuery ? theme.text : theme.dim },
                    { text: '█', fg: theme.cyan },
                    { text: '  j/k move · ⏎ run · esc close', fg: theme.dim },
                    { text: positionHint, fg: theme.muted },
                  ], paletteW - 4, theme.dim)}
                </text>
              </box>
              {hiddenAbove > 0 ? (
                <box paddingX={1}>
                  <text fg={theme.dim} wrapMode="none">{`▲ ${hiddenAbove} more`}</text>
                </box>
              ) : null}
              {filteredCommands.length === 0 ? (
                <box paddingX={1}>
                  <text fg={theme.dim}>no matches</text>
                </box>
              ) : visibleRows.map((row, i) => {
                if (row.kind === 'header') {
                  return (
                    <box key={`palette-row:${i}`} paddingX={1} backgroundColor={theme.surface2} flexDirection="row">
                      <text fg={theme.cyan} wrapMode="none">{'┄ '}</text>
                      <text fg={theme.cyan} wrapMode="none">{row.label.toUpperCase()}</text>
                    </box>
                  )
                }
                const isSelected = row.cmdIndex === commandPaletteIndex
                return (
                  <box
                    key={`palette-row:${i}`}
                    paddingX={1}
                    backgroundColor={isSelected ? theme.surface3 : theme.surface}
                    flexDirection="row"
                  >
                    <text fg={theme.cyan} wrapMode="none">{isSelected ? '▎' : ' '}</text>
                    <box flexGrow={1}>
                      <text fg={isSelected ? theme.text : theme.muted} wrapMode="none">
                        {fitText(row.cmd.label, labelW - 1)}
                      </text>
                    </box>
                    <box width={shortcutW} justifyContent="flex-end">
                      <text fg={isSelected ? theme.cyan : theme.dim} wrapMode="none">
                        {fitText(row.cmd.key, shortcutW)}
                      </text>
                    </box>
                  </box>
                )
              })}
              {hiddenBelow > 0 ? (
                <box paddingX={1}>
                  <text fg={theme.dim} wrapMode="none">{`▼ ${hiddenBelow} more`}</text>
                </box>
              ) : null}
            </box>
          )
        })() : null
  )
}
