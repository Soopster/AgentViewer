/** @jsxImportSource @opentui/react */
// A scrollbar for a windowed list (the palette and the ⌃B/⌃K help): those
// render only the rows on show, so OpenTUI's scrollbox bar has nothing to
// measure. One column, a cell per visible row; a press on the track jumps there.
import type { TuiThemePalette } from '../../../theme'

/** Which cells of a `rows`-tall track the thumb covers. */
export function scrollbarThumb(total: number, rows: number, start: number): { from: number; to: number } | null {
  if (rows <= 0 || total <= rows) return null
  const size = Math.max(1, Math.round((rows * rows) / total))
  const maxStart = total - rows
  const from = Math.round((start / maxStart) * (rows - size))
  return { from, to: from + size }
}

export function ListScrollbar({ id, total, rows, start, theme, onJump }: {
  id: string
  total: number
  rows: number
  start: number
  theme: TuiThemePalette
  /** Called with the start row a press on the track asks for. */
  onJump: (start: number) => void
}) {
  const thumb = scrollbarThumb(total, rows, start)
  if (!thumb) return null
  const maxStart = total - rows
  return (
    <box id={id} width={1} flexShrink={0} flexDirection="column">
      {Array.from({ length: rows }, (_, cell) => {
        const inThumb = cell >= thumb.from && cell < thumb.to
        return (
          <box key={cell} height={1} width={1}
            onMouseDown={(event: { button?: number; stopPropagation?: () => void }) => {
              event.stopPropagation?.()
              if ((event.button ?? 0) === 0) onJump(Math.round((cell / Math.max(rows - 1, 1)) * maxStart))
            }}>
            <text fg={inThumb ? theme.muted : theme.border} wrapMode="none" selectable={false}>{inThumb ? '█' : '│'}</text>
          </box>
        )
      })}
    </box>
  )
}
