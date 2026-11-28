/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../theme'

/** Shared by window dividers and pane borders. */
export function ResizeReadout({ id, left, top, width = 26, label, theme, zIndex = 901 }: {
  id: string; left: number; top: number; width?: number; label: string; theme: TuiThemePalette; zIndex?: number
}) {
  return <box id={id} position="absolute" left={left} top={top} width={width} height={1}
    zIndex={zIndex} backgroundColor={theme.cyan}>
    <text fg={theme.bg} selectable={false} wrapMode="none">{` ${label} `}</text>
  </box>
}
