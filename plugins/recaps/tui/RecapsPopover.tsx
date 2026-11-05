/** @jsxImportSource @opentui/react */
// The switch for idle recaps, and the open session's own recap. Off by default:
// a recap sends recent transcript text to a model.
import { useCallback, useEffect, useState } from 'react'
import { popoverFrameCells, popoverRootProps, type TuiPluginKeyEvent, type TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import { readTuiSessionRecapsEnabled, setTuiSessionRecapsEnabled } from '../../../lib/tui/service'
import type { SessionRecap } from '../../../lib/sessionRecap'

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  recap: SessionRecap | null
  onClose: () => void
  onNotice: (tone: 'info' | 'error', text: string) => void
  onKeyHandlerReady: (handler: (key: TuiPluginKeyEvent) => void) => void
  docked?: boolean
}

export function RecapsPopover({ theme, width, height, recap, onClose, onNotice, onKeyHandlerReady, docked = false }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void readTuiSessionRecapsEnabled().then((value) => { if (!cancelled) setEnabled(value) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const toggle = useCallback(() => {
    if (enabled === null) return
    void setTuiSessionRecapsEnabled(!enabled)
      .then((next) => {
        setEnabled(next)
        onNotice('info', next ? 'Session recaps on — idle sessions get a summary after a minute' : 'Session recaps off')
      })
      .catch((error) => onNotice('error', error instanceof Error ? error.message : 'Could not change session recaps'))
  }, [enabled, onNotice])

  const handleKey = useCallback((key: TuiPluginKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    if (key.name === 'return' || key.name === 'space' || key.sequence === ' ') toggle()
  }, [onClose, toggle])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 72)
  const popH = docked ? height : Math.min(height - 4, 14)
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
      title={docked ? undefined : ' Session recaps '}
      titleAlignment="left"
      paddingX={1}
    >
      <text fg={enabled ? theme.green : theme.muted} wrapMode="none">
        {enabled === null ? 'Reading setting…' : enabled ? '● On' : '○ Off'}
      </text>
      <text fg={theme.text} wrapMode="none">{clip('A minute after a session goes quiet, a small model writes a one-line')}</text>
      <text fg={theme.text} wrapMode="none">{clip('recap and, when obvious, a next message (Tab in an empty composer).')}</text>
      <text fg={theme.dim} wrapMode="none">{clip('Sends recent transcript text to the model (Claude Haiku by default).')}</text>
      <text fg={theme.dim} wrapMode="none">{' '}</text>
      <text fg={theme.cyan} wrapMode="none">{clip('This session:')}</text>
      <text fg={recap ? theme.text : theme.dim} wrapMode="none">{clip(recap?.text ?? 'no recap yet')}</text>
      {recap?.suggestion ? <text fg={theme.muted} wrapMode="none">{clip(`→ ${recap.suggestion.replace(/\s+/g, ' ')}`)}</text> : null}
      <box flexGrow={1} />
      <text fg={theme.dim} wrapMode="none">{clip('enter toggle · esc close')}</text>
    </box>
  )
}
