/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../theme'
import { fitText } from '../textLayout'
import { EngineeringAction as Action } from './EngineeringAction'
import type { EngineeringPreset } from './model'

const PRESETS: EngineeringPreset[] = ['focus', 'build', 'review', 'multi-agent']
const LABELS = { focus: 'Focus', build: 'Build', review: 'Review', 'multi-agent': 'Agents' }
export function EngineeringHeader({ width, rows, theme, title, preset, onPreset, onInspector, onTerminal }: {
  width: number; rows: number; theme: TuiThemePalette; title: string; preset: EngineeringPreset
  onPreset: (preset: EngineeringPreset) => void; onInspector: () => void; onTerminal: () => void
}) {
  const titleWidth = rows === 1 ? Math.max(20, width - (PRESETS.reduce((sum, value) => sum + LABELS[value].length + 2, 0) + 'F8 Inspector'.length + 'F9 Terminal'.length + 4)) : width
  return <box id="engineering-header" height={rows} flexShrink={0} flexDirection={rows === 1 ? 'row' : 'column'} backgroundColor={theme.surface2}>
    <box height={1} flexGrow={rows === 1 ? 1 : 0} minWidth={0} overflow="hidden">
      <text fg={theme.text} wrapMode="none">{fitText(title, titleWidth)}</text>
    </box>
    <box height={1} flexShrink={0} flexDirection="row">
      {PRESETS.map(value => <Action key={value} theme={theme} selected={preset === value} label={LABELS[value]} onPress={() => onPreset(value)} />)}
      <Action theme={theme} label="F8 Inspector" onPress={onInspector} />
      <Action theme={theme} label="F9 Terminal" onPress={onTerminal} />
    </box>
  </box>
}
