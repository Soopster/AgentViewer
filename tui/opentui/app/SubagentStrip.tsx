/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../theme'
import { fitText } from '../textLayout'
import { formatElapsedClock } from './format'
import { WindowButton } from '../WindowButton'
import type { SubagentStripEntry } from './subagentCards'

const GLYPH = { running: '●', completed: '✓', failed: '×', unknown: '·' } as const

function entryLabel(entry: SubagentStripEntry): string {
  const duration = entry.durationMs != null && entry.durationMs >= 1000 ? ` ${formatElapsedClock(entry.durationMs)}` : ''
  return ` ${GLYPH[entry.state]} ${fitText(entry.name, Math.min(entry.name.length, 28))}${duration} `
}

/** One row naming the latest turn's sub-agents; what does not fit is counted. */
export function SubagentStrip({ entries, width, theme, onOpen }: {
  entries: readonly SubagentStripEntry[]; width: number; theme: TuiThemePalette; onOpen: (entry: SubagentStripEntry) => void
}) {
  const shown: SubagentStripEntry[] = []
  let used = 0
  for (const entry of entries) {
    const cells = entryLabel(entry).length
    if (used + cells > width - 6) break
    used += cells
    shown.push(entry)
  }
  const color = { running: theme.amber, completed: theme.green, failed: theme.red, unknown: theme.muted }
  return <box id="subagent-strip" height={1} flexShrink={0} paddingX={1} flexDirection="row" backgroundColor={theme.surface}>
    {shown.map(entry => entry.threadId
      ? <WindowButton key={entry.id} id={`subagent-strip:${entry.name}`} label={entryLabel(entry)} theme={theme} foreground={color[entry.state]} background={theme.surface} onPress={() => onOpen(entry)} />
      : <text key={entry.id} fg={color[entry.state]} wrapMode="none">{entryLabel(entry)}</text>)}
    {shown.length < entries.length ? <text fg={theme.dim} wrapMode="none">{` +${entries.length - shown.length}`}</text> : null}
  </box>
}
