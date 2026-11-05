/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react'
import type { TuiThemePalette } from '../theme'
import { MODAL_SCRIM_Z_INDEX } from './layers'
import { fitText } from './textLayout'
import { WINDOW_MANAGEMENT_ACTION_HINT, WINDOW_MANAGEMENT_HINT, type ControlWindow } from './windowControls'

export function WindowControlOverlay({ mode, theme, width, height, readWindows, onPick, onMenu }: {
  mode: 'identify' | 'manage'; theme: TuiThemePalette; width: number; height: number
  readWindows: () => ControlWindow[]; onPick: (key: string) => void; onMenu: (key: string, point: { x: number; y: number }) => void
}) {
  const [windows, setWindows] = useState<ControlWindow[]>([])
  // Layout is committed after React renders. Observe only while the controls
  // are open; do not subscribe transcripts to geometry or remount their content.
  useEffect(() => {
    const update = () => {
      const next = readWindows()
      setWindows(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    update()
    const timer = setInterval(update, 80)
    return () => clearInterval(timer)
  }, [readWindows, width, height])
  return <>
    {windows.map(window => {
      const { rect } = window
      const color = window.focused ? theme.cyan : theme.amber
      return <box key={window.key} id={`window-control:${window.number}`} position="absolute"
        left={rect.x} top={rect.y} width={rect.width} height={rect.height}
        border borderStyle="single" borderColor={color} zIndex={MODAL_SCRIM_Z_INDEX - 2}
        onMouseDown={event => {
          event.stopPropagation()
          if (event.button === 0) onPick(window.key)
          else if (event.button === 2) onMenu(window.key, event)
        }}>
        <box position="absolute" left={0} top={0} width={Math.max(1, rect.width - 2)} height={Math.min(2, Math.max(1, rect.height - 2))} backgroundColor={theme.surface3} flexDirection="column">
          <text fg={color} wrapMode="none" selectable={false}>{fitText(`${window.number} · ${window.title}`, Math.max(1, rect.width - 2))}</text>
          {rect.height > 3 ? <text fg={theme.muted} wrapMode="none" selectable={false}>{fitText(`${rect.width} cols × ${rect.height} rows`, Math.max(1, rect.width - 2))}</text> : null}
        </box>
      </box>
    })}
    <box id="window-control-guide" position="absolute" left={0} top={Math.max(0, height - (mode === 'manage' ? 4 : 1))}
      width={width} height={Math.min(height, mode === 'manage' ? 4 : 1)} backgroundColor={theme.surface3} zIndex={MODAL_SCRIM_Z_INDEX - 1} flexDirection="column">
      <text fg={theme.amber} wrapMode="none" selectable={false}>{fitText(mode === 'manage' ? 'MANAGE WINDOWS · Esc / Enter finish' : 'IDENTIFY WINDOWS · 1–9 / click focus · Esc cancel', width)}</text>
      {mode === 'manage' ? <>
        <text fg={theme.text} wrapMode="none" selectable={false}>{fitText(WINDOW_MANAGEMENT_HINT, width)}</text>
        <text fg={theme.muted} wrapMode="none" selectable={false}>{fitText(WINDOW_MANAGEMENT_ACTION_HINT, width)}</text>
        <text fg={theme.muted} wrapMode="none" selectable={false}>{fitText('< > focused size · + - grid row size · space menu for all actions', width)}</text>
      </> : null}
    </box>
  </>
}
