/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoxRenderable } from '@opentui/core'
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

  // Mouse: hover moves the cursor, a click opens, a drag reorders (one step at a
  // time through tabs.move, so the pinned boundary holds), the wheel scrolls.
  const listRef = useRef<BoxRenderable>(null)
  const press = useRef<{ key: string; y: number; dragged: boolean } | null>(null)
  const dragTo = (y: number) => {
    const held = press.current
    const list = listRef.current
    if (!held || !list) return
    if (y !== held.y) held.dragged = true
    const target = Math.max(0, Math.min(top + (y - list.y), keys.length - 1))
    // Each move re-renders with a new order; step once per event toward the target.
    const from = keys.indexOf(held.key)
    const session = tabs.sessions[from]
    if (session && target !== from) tabs.move(session, target > from ? 1 : -1)
  }
  const button = (label: string, color: string, run: () => void) => (
    <text fg={color} wrapMode="none" selectable={false}
      onMouseDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); run() }}>{label}</text>
  )

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
      <box ref={listRef} flexDirection="column" height={listRows}
        onMouseScroll={(event) => {
          event.stopPropagation()
          const next = keys[Math.max(0, Math.min(at + (event.scroll?.direction === 'up' ? -1 : 1), keys.length - 1))]
          if (next) setCursorKey(next)
        }}>
        {tabs.sessions.slice(top, top + listRows).map((session, index) => {
          const key = sessionIdentityKey(session)
          const selected = top + index === at
          const pinned = tabs.pinned.has(key)
          return (
            <box key={key} id={`tab-manager-row:${key}`} flexDirection="row" height={1} backgroundColor={selected ? theme.surface3 : theme.surface}
              onMouseOver={() => { if (!press.current) setCursorKey(key) }}
              onMouseDown={(event) => {
                if (event.button === 1) { event.stopPropagation(); tabs.close(session); return }
                if (event.button !== 0) return
                event.stopPropagation()
                setCursorKey(key)
                press.current = { key, y: event.y, dragged: false }
              }}
              onMouseDrag={(event) => dragTo(event.y)}
              onMouseUp={() => {
                const held = press.current
                press.current = null
                if (held && !held.dragged && held.key === key) onSelect(session)
              }}>
              <text flexGrow={1} flexShrink={1} fg={selected ? theme.text : theme.muted} wrapMode="none" selectable={false}>
                {clip(`${selected ? '▎' : ' '} ${pinned ? '◆' : ' '} ${key === tabs.selectedKey ? '● ' : '  '}${formatSessionTitle(session)}`, innerW - 8)}
              </text>
              {/* Row actions appear on the row under the cursor, as Chrome's tab search shows × on hover. */}
              {selected ? button(pinned ? ' unpin ' : ' pin ', theme.cyan, () => tabs.togglePin(session)) : null}
              {selected ? button(' × ', theme.red, () => tabs.close(session)) : null}
            </box>
          )
        })}
      </box>
      <box flexGrow={1} />
      <box flexDirection="row" height={1}>
        <text fg={theme.dim} wrapMode="none" selectable={false}>{clip('click open · drag reorder · ', innerW)}</text>
        {button(`pinned row ${tabs.row ? 'on' : 'off'}`, theme.cyan, () => { tabs.toggleRow() })}
        <text fg={theme.dim} wrapMode="none" selectable={false}> · j/k · p pin · [ ] · x · </text>
        {button('esc', theme.cyan, onClose)}
      </box>
    </box>
  )
}
