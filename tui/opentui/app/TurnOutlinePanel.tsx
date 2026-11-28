/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../theme'
import { fitText } from '../textLayout'
import { chooseTurnOutlineRow, useTurnOutline } from './turnOutline'

export function TurnOutlinePanel({ owner, width, rows, theme }: { owner: string; width: number; rows: number; theme: TuiThemePalette }) {
  const outline = useTurnOutline(owner)
  if (!outline) return null
  const panelWidth = Math.max(Math.min(width - 2, 100), 20)
  const visible = Math.max(Math.min(outline.rows.length, rows - 3), 1)
  const start = Math.max(0, Math.min(outline.index - Math.floor(visible / 2), outline.rows.length - visible))
  const inner = panelWidth - 4
  return <box id="turn-outline" position="absolute" top={0} left={1} width={panelWidth} height={visible + 3} zIndex={6}
    border borderStyle="rounded" borderColor={theme.cyan} backgroundColor={theme.surface2} flexDirection="column" paddingX={1}
    title=" Turns " onMouseDown={event => event.stopPropagation()}>
    {outline.rows.slice(start, start + visible).map((row, offset) => {
      const selected = start + offset === outline.index
      const detail = row.detail ? `  ${row.detail}` : ''
      const prefix = `${selected ? '▎' : ' '}${String(row.number).padStart(3)}  `
      const promptWidth = Math.max(inner - prefix.length - detail.length, 8)
      return <box key={row.key} id={`turn-outline:${row.number}`} height={1} flexDirection="row" backgroundColor={selected ? theme.surface3 : theme.surface2}
        onMouseUp={() => chooseTurnOutlineRow(start + offset)}>
        <text fg={selected ? theme.cyan : theme.muted} wrapMode="none" selectable={false}>{prefix}</text>
        <text fg={theme.text} width={promptWidth} wrapMode="none" selectable={false}>{fitText(row.prompt, promptWidth)}</text>
        <text fg={row.failed ? theme.red : theme.muted} wrapMode="none" selectable={false}>{detail}</text>
      </box>
    })}
    <text fg={theme.dim} wrapMode="none">{fitText(`${outline.partial ? 'loaded turns only · ' : ''}↑↓ move · ⏎ jump · esc close`, inner)}</text>
  </box>
}
