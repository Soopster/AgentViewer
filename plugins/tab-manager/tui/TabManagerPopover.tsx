/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useState } from 'react'
import { PopoverDetachButton, popoverFrameCells, popoverRootProps, type TuiPluginKeyEvent, type TuiThemePalette } from '../../../tui/opentui/shell/sdk'
import { formatSessionTitle } from '../../../tui/format'
import { sessionIdentityKey } from '../../../tui/opentui/shell/sdk'
import type { Session } from '../../../lib/types'

type Tabs = {
  sessions: readonly Session[]
  pinned: ReadonlySet<string>
  selectedKey: string | null
  row: boolean
  toggleRow: () => boolean
  togglePin: (session: Session) => boolean
  move: (session: Session, delta: -1 | 1) => void
  close: (session: Session) => void
}

type Props = {
  theme: TuiThemePalette
  width: number
  height: number
  tabs: Tabs
  onSelect: (session: Session) => void
  onClose: () => void
  onDetach?: () => void
  onKeyHandlerReady: (handler: (key: TuiPluginKeyEvent) => void) => void
  docked?: boolean
}

export function TabManagerPopover({ theme, width, height, tabs, onSelect, onClose, onDetach, onKeyHandlerReady, docked = false }: Props) {
  const [cursorKey, setCursorKey] = useState<string | null>(tabs.selectedKey)
  const keys = tabs.sessions.map((session) => sessionIdentityKey(session))
  const at = Math.max(cursorKey ? keys.indexOf(cursorKey) : 0, 0)
  const current = tabs.sessions[at]

  const handleKey = useCallback((key: TuiPluginKeyEvent) => {
    if (key.name === 'escape') { onClose(); return }
    const step = (delta: number) => { const next = keys[Math.max(0, Math.min(at + delta, keys.length - 1))]; if (next) setCursorKey(next) }
    if (key.name === 'down' || key.sequence === 'j') step(1)
    else if (key.name === 'up' || key.sequence === 'k') step(-1)
    else if (key.sequence === 'g') step(-keys.length)
    else if (key.sequence === 'G') step(keys.length)
    else if (key.sequence === 'r') tabs.toggleRow()
    else if (!current) return
    else if (key.sequence === 'p') tabs.togglePin(current)
    else if (key.sequence === '[' || key.sequence === '{') tabs.move(current, -1)
    else if (key.sequence === ']' || key.sequence === '}') tabs.move(current, 1)
    else if (key.sequence === 'x') tabs.close(current)
    else if (key.name === 'return') onSelect(current)
  }, [at, current, keys, onClose, onSelect, tabs])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const frame = popoverFrameCells(docked)
  const popW = docked ? width : Math.min(width - 4, 80)
  const popH = docked ? height : Math.min(height - 4, 24)
  const popTop = Math.floor((height - popH) / 2)
  const popLeft = Math.floor((width - popW) / 2)
  const innerW = Math.max(popW - frame - 2, 20)
  const listRows = Math.max(popH - frame - 3, 3)
  const clip = (text: string, limit = innerW) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text)
  const top = Math.max(0, Math.min(at - Math.floor(listRows / 2), Math.max(tabs.sessions.length - listRows, 0)))

  return (
    <box
      {...popoverRootProps(docked, { top: popTop, left: popLeft, width: popW, height: popH }, 50)}
      {...(docked ? {} : { border: true, borderStyle: 'single' as const, borderColor: theme.border2 })}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={docked ? undefined : ' Tabs '}
      titleAlignment="left"
      paddingX={1}
    >
      {!docked && onDetach ? <PopoverDetachButton theme={theme} onPress={onDetach} /> : null}
      <text fg={theme.muted} wrapMode="none">
        {clip(tabs.sessions.length === 0 ? 'No open tabs' : `${tabs.sessions.length} tab${tabs.sessions.length === 1 ? '' : 's'} · ${tabs.pinned.size} pinned · pinned row ${tabs.row ? 'on' : 'off'}`)}
      </text>
      <box flexDirection="column" height={listRows}>
        {tabs.sessions.slice(top, top + listRows).map((session, index) => {
          const key = sessionIdentityKey(session)
          const selected = top + index === at
          return (
            <text key={key} fg={selected ? theme.text : theme.muted} bg={selected ? theme.surface3 : undefined} wrapMode="none">
              {clip(`${selected ? '▎' : ' '} ${tabs.pinned.has(key) ? '◆' : ' '} ${key === tabs.selectedKey ? '● ' : '  '}${formatSessionTitle(session)}`)}
            </text>
          )
        })}
      </box>
      <box flexGrow={1} />
      <text fg={theme.dim} wrapMode="none">{clip('j/k move · p pin · r pinned row · [ ] reorder · enter · x close · esc')}</text>
    </box>
  )
}
