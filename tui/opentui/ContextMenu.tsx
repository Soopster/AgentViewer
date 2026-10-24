/** @jsxImportSource @opentui/react */
// A right-click menu at the pointer: the actions that apply to what was
// clicked, lit under the pointer, picked by click or by arrows and Enter.
import { useCallback, useEffect, useState } from 'react'

import type { TuiThemePalette } from '../theme'
import { MODAL_CONTENT_Z_INDEX } from './layers'
import { fitText } from './textLayout'

export type ContextMenuItem = {
  label: string
  /** The key that does the same thing elsewhere, shown dim on the right. */
  hint?: string
  danger?: boolean
  run: () => void
}

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }

export function ContextMenu({
  theme,
  x,
  y,
  title,
  items,
  screenWidth,
  screenHeight,
  onClose,
  onKeyHandlerReady,
}: {
  theme: TuiThemePalette
  x: number
  y: number
  title?: string
  items: ContextMenuItem[]
  screenWidth: number
  screenHeight: number
  onClose: () => void
  onKeyHandlerReady: (handler: (key: Key) => void) => void
}) {
  const [cursor, setCursor] = useState(0)
  const [wheelStart, setWheelStart] = useState(0)
  const capacity = Math.max(1, screenHeight - 4)
  const selected = Math.min(cursor, Math.max(0, items.length - 1))
  const start = Math.min(Math.max(wheelStart, selected - capacity + 1), Math.max(0, items.length - capacity))
  const visibleStart = selected < start ? selected : start
  const pick = useCallback((index: number) => {
    const item = items[index]
    onClose()
    item?.run()
  }, [items, onClose])

  const handleKey = useCallback((key: Key) => {
    if (key.name === 'escape' || key.sequence === 'q') { onClose(); return }
    if (key.name === 'down' || key.sequence === 'j') { setWheelStart(Math.max(0, selected + 2 - capacity)); setCursor(Math.min(items.length - 1, selected + 1)); return }
    if (key.name === 'up' || key.sequence === 'k') { setWheelStart(Math.min(wheelStart, Math.max(0, selected - 1))); setCursor(Math.max(0, selected - 1)); return }
    if (key.name === 'return' || key.name === 'space') pick(selected)
  }, [selected, items.length, onClose, pick, capacity, wheelStart])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])

  const inner = Math.max(...items.map((item) => item.label.length + (item.hint ? item.hint.length + 3 : 0)), (title ?? '').length + 2, 12)
  const width = Math.min(inner + 4, Math.max(3, screenWidth))
  const height = Math.min(items.length, capacity) + 2
  // Kept on screen: a click near the right or bottom edge opens the menu toward the middle.
  const left = Math.max(0, Math.min(x, screenWidth - width - 1))
  const top = Math.max(0, Math.min(y + 1, screenHeight - height - 1))

  return (
    <box
      id="context-menu"
      position="absolute"
      top={top}
      left={left}
      width={width}
      height={height}
      zIndex={MODAL_CONTENT_Z_INDEX}
      border
      borderStyle="rounded"
      borderColor={theme.border2}
      backgroundColor={theme.surface}
      flexDirection="column"
      title={title ? ` ${fitText(title, Math.max(1, width - 6)).trimEnd()} ` : undefined}
      titleColor={theme.dim}
      // A press inside is the menu's; the backdrop behind it closes on any other.
      onMouseDown={(event: { stopPropagation?: () => void }) => event.stopPropagation?.()}
      onMouseScroll={event => {
        event.stopPropagation()
        const next = Math.max(0, Math.min(items.length - 1, selected + (event.scroll?.direction === 'up' ? -1 : 1)))
        setCursor(next)
        setWheelStart(Math.max(0, Math.min(next, Math.max(visibleStart, next - capacity + 1))))
      }}
    >
      {items.slice(visibleStart, visibleStart + capacity).map((item, offset) => {
        const index = visibleStart + offset
        const hintWidth = Math.min(item.hint?.length ?? 0, Math.max(0, width - 12))
        const labelWidth = Math.max(1, width - 4 - (hintWidth ? hintWidth + 1 : 0))
        return (
          <box
            key={item.label}
            id={`context-menu:${index}`}
            flexDirection="row"
            height={1}
            flexShrink={0}
            paddingX={1}
            backgroundColor={index === cursor ? theme.surface3 : undefined}
            onMouseOver={() => setCursor(index)}
            onMouseDown={(event: { button: number; stopPropagation?: () => void }) => {
              event.stopPropagation?.()
              if (event.button === 0 || event.button === 2) pick(index)
            }}
          >
            <text fg={item.danger ? theme.red : index === cursor ? theme.text : theme.muted} wrapMode="none" selectable={false}>{fitText(item.label, labelWidth)}</text>
            <box flexGrow={1} />
            {hintWidth ? <text fg={theme.dim} wrapMode="none" selectable={false}>{fitText(item.hint!, hintWidth)}</text> : null}
          </box>
      )})}
    </box>
  )
}
