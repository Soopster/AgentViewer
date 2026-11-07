/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../theme'
import { fitText } from '../textLayout'
import { EngineeringAction as Action } from './EngineeringAction'

export function EngineeringHeader({ width, rows, theme, title, focusMode, onToggleFocus, onInspector, onTerminal }: {
  width: number; rows: number; theme: TuiThemePalette; title: string; focusMode: boolean
  onToggleFocus: () => void; onInspector: () => void; onTerminal: () => void
}) {
  const titleWidth = rows === 1 ? Math.max(20, width - ('F7 Focus'.length + 'F8 Inspector'.length + 'F9 Terminal'.length + 6)) : width
  return <box id="engineering-header" height={rows} flexShrink={0} flexDirection={rows === 1 ? 'row' : 'column'} backgroundColor={theme.surface2}>
    <box height={1} flexGrow={rows === 1 ? 1 : 0} minWidth={0} overflow="hidden">
      <text fg={theme.text} wrapMode="none">{fitText(title, titleWidth)}</text>
    </box>
    <box height={1} flexShrink={0} flexDirection="row">
      <Action id="engineering-focus" theme={theme} selected={focusMode} label="F7 Focus" onPress={onToggleFocus} />
      <Action theme={theme} label="F8 Inspector" onPress={onInspector} />
      <Action theme={theme} label="F9 Terminal" onPress={onTerminal} />
    </box>
  </box>
}
