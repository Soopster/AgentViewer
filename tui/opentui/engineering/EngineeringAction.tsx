/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../theme'

export function EngineeringAction({ id, label, onPress, theme, selected = false, tone }: {
  id?: string
  label: string; onPress: () => void; theme: TuiThemePalette; selected?: boolean; tone?: string
}) {
  return <box id={id} height={1} flexShrink={0} onMouseDown={event => {
    if (event.button === 0) { event.stopPropagation(); onPress() }
  }}>
    <text selectable={false} fg={selected ? theme.text : tone ?? theme.cyan}
      bg={selected ? theme.surface3 : undefined} wrapMode="none">{` ${label} `}</text>
  </box>
}
