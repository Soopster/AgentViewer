/** @jsxImportSource @opentui/react */
import { useSyncExternalStore } from 'react'
import { getPiActivitySnapshot, subscribeToPiActivity } from '../../../lib/piActivity'
import type { TuiPluginWidgetProps } from '../../../tui/opentui/shell/sdk'

/** Pi's package/extension loading progress, while it runs or has failed. */
export function PiActivityWidget({ theme, width, height }: TuiPluginWidgetProps) {
  const snapshot = useSyncExternalStore(subscribeToPiActivity, getPiActivitySnapshot, getPiActivitySnapshot)
  if (!snapshot.active && snapshot.stage !== 'error') return null

  const events = snapshot.events.slice(-5)
  const popH = Math.min(events.length + 5, Math.max(6, height - 2))

  return (
    <box
      width={width}
      height={popH}
      border
      borderStyle="single"
      borderColor={snapshot.stage === 'error' ? theme.red : theme.cyan}
      backgroundColor={theme.surface}
      flexDirection="column"
      paddingX={1}
      title=" Pi activity "
      titleColor={snapshot.stage === 'error' ? theme.red : theme.cyan}
    >
      <text fg={snapshot.stage === 'error' ? theme.red : theme.text} wrapMode="none">
        {snapshot.active ? `● ${snapshot.headline}` : snapshot.headline}
      </text>
      <text fg={theme.dim} wrapMode="none">Pi may run npm with --legacy-peer-deps</text>
      {events.map((event) => (
        <text key={event.id} fg={event.tone === 'error' ? theme.red : event.tone === 'success' ? theme.green : theme.dim} wrapMode="none">
          {event.message}
        </text>
      ))}
    </box>
  )
}
