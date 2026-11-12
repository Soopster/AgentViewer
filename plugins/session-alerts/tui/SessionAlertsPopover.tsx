/** @jsxImportSource @opentui/react */
// The switch for session alerts. The mode lives in the host (tui.json); this only shows and cycles it.
import { useCallback, useEffect } from 'react'
import { cycleSessionAlertMode, useSessionAlertMode } from './modeStore'
import { PopoverDetachButton, popoverFrameCells, popoverRootProps, type TuiPluginKeyEvent, type TuiThemePalette } from '../../../tui/opentui/shell/sdk'

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  onClose: () => void
  onDetach?: () => void
  onKeyHandlerReady: (handler: (key: TuiPluginKeyEvent) => void) => void
  docked?: boolean
}

const MODE_TEXT = {
  desktop: 'Desktop — a notification when the terminal is in the background, a notice when you are elsewhere',
  'in-app': 'In-app — a notice when you are looking at another session; no desktop notifications',
  off: 'Off',
} as const

export function SessionAlertsPopover({ theme, width, height, onClose, onDetach, onKeyHandlerReady, docked = false }: Props) {
  const mode = useSessionAlertMode()
  const handleKey = useCallback((key: TuiPluginKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    if (key.name === 'return' || key.name === 'space' || key.sequence === ' ' || key.name === 'right' || key.name === 'left') cycleSessionAlertMode()
  }, [onClose])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 96)
  const popH = docked ? height : Math.min(height - 4, 12)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = Math.max(popW - frame - 2, 20)
  const clip = (text: string) => (text.length > innerW ? `${text.slice(0, innerW - 1)}…` : text)

  return (
    <box
      {...popoverRootProps(docked, { top: popTop, left: popLeft, width: popW, height: popH }, 50)}
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={docked ? undefined : ' Session alerts '}
      titleAlignment="left"
      paddingX={1}
    >
      {!docked && onDetach ? <PopoverDetachButton theme={theme} onPress={onDetach} /> : null}
      <text fg={mode === 'off' ? theme.muted : theme.green} wrapMode="none">{clip(mode === 'off' ? '○ Off' : `● ${mode === 'desktop' ? 'Desktop' : 'In-app'}`)}</text>
      <text fg={theme.text} wrapMode="none">{clip(MODE_TEXT[mode])}</text>
      <text fg={theme.dim} wrapMode="none">{' '}</text>
      <text fg={theme.text} wrapMode="none">{clip('You are told when a session needs your answer or approval, and when a turn')}</text>
      <text fg={theme.text} wrapMode="none">{clip('that ran 15 seconds or more finishes. Turns already running at launch are not replayed.')}</text>
      <box flexGrow={1} />
      <text fg={theme.dim} wrapMode="none">{clip('enter cycle desktop / in-app / off · esc close')}</text>
    </box>
  )
}
