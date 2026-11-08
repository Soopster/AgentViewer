/** @jsxImportSource @opentui/react */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useRenderer } from '@opentui/react'
import { parseColor, type BoxRenderable, type TabSelectRenderable } from '@opentui/core'

type Rect = { x: number; y: number; width: number; height: number }

/** Connect only to the owning frame directly below the existing tab row.
 * Never cross a neighbouring pane, an overflow banner, or title controls.
 * A tab may sit flush with the frame's left edge (`flushLeft`): its side then
 * meets the frame's corner instead of drawing a second one beside it. */
export function tabConnectionGeometry(tabs: Rect, frame: Rect, index: number, offset: number, tabWidth: number) {
  const column = (index - offset) * tabWidth
  const left = tabs.x + column
  const right = left + tabWidth - 1
  const borderEnd = frame.x + frame.width - 22
  if (column < 0 || column + tabWidth > tabs.width || tabWidth < 4
    || tabs.height !== 1 || frame.y !== tabs.y + 1
    || left < frame.x || right >= borderEnd) return null
  return { left, right, flushLeft: left === frame.x, topY: tabs.y - 1, tabY: tabs.y, borderY: frame.y, borderStart: frame.x + 1, borderEnd }
}

/** Native chrome only: no layout changes, timers, hit targets, or root updates.
 * Paint the cap, label sides and pane join using current native coordinates, so resize and tab
 * scrolling cannot leave a connector on yesterday's window. */
export function SessionTabConnection(props: {
  tabs: React.RefObject<TabSelectRenderable | null>
  readWindow: () => BoxRenderable | null
  ownerKey: string | null
  enabled: boolean
  foreground: string
  background: string
  inactiveForeground: string
  inactiveBackground: string
}) {
  const renderer = useRenderer()
  const latest = useRef(props)
  const colors = useMemo(() => ({
    foreground: parseColor(props.foreground), background: parseColor(props.background),
    inactiveForeground: parseColor(props.inactiveForeground), inactiveBackground: parseColor(props.inactiveBackground),
  }), [props.foreground, props.background, props.inactiveForeground, props.inactiveBackground])
  const palette = useRef(colors)
  useLayoutEffect(() => { latest.current = props; palette.current = colors })
  useEffect(() => {
    if (!props.enabled) return
    const paint = (buffer: Parameters<Parameters<typeof renderer.addPostProcessFn>[0]>[0]) => {
      const current = latest.current
      if (!current.enabled) return
      const tabs = current.tabs.current
      const frame = current.readWindow()
      if (!tabs || !frame || !tabs.visible || !frame.visible
        || tabs.getSelectedOption()?.value !== current.ownerKey) return
      const connection = tabConnectionGeometry(tabs, frame, tabs.getSelectedIndex(),
        (tabs as unknown as { scrollOffset: number }).scrollOffset ?? 0, tabs.getTabWidth())
      if (!connection || connection.left < 0 || connection.topY < 0 || connection.borderY >= buffer.height || connection.borderEnd >= buffer.width) return
      // A covering overlay must not acquire a hole in its own border/content.
      const uncovered = buffer.withBuffers(cells => ['┌', '╭'].some(c => cells.char[frame.y * cells.width + frame.x] === c.codePointAt(0)))
      if (!uncovered) return
      const { foreground, background, inactiveForeground, inactiveBackground } = palette.current
      // Inactive tabs keep their own muted cap and sides, standing on the
      // window border (┴, or ├ at the frame's corner). Only the selected tab
      // opens into it; empty strip space stays bare.
      const offset = (tabs as unknown as { scrollOffset: number }).scrollOffset ?? 0
      for (let index = offset; index < tabs.options.length; index++) {
        if ((index - offset + 1) * tabs.getTabWidth() > tabs.width) break
        if (index === tabs.getSelectedIndex()) continue
        const inactive = tabConnectionGeometry(tabs, frame, index, offset, tabs.getTabWidth())
        if (!inactive) continue
        buffer.drawText('╭' + '─'.repeat(inactive.right - inactive.left - 1) + '╮', inactive.left, inactive.topY, inactiveForeground, inactiveBackground)
        buffer.drawText('│', inactive.left, inactive.tabY, inactiveForeground, inactiveBackground)
        buffer.drawText('│', inactive.right, inactive.tabY, inactiveForeground, inactiveBackground)
      }
      buffer.drawText('─'.repeat(connection.borderEnd - connection.borderStart), connection.borderStart, connection.borderY, foreground, background)
      for (let index = offset; index < tabs.options.length; index++) {
        if ((index - offset + 1) * tabs.getTabWidth() > tabs.width) break
        if (index === tabs.getSelectedIndex()) continue
        const inactive = tabConnectionGeometry(tabs, frame, index, offset, tabs.getTabWidth())
        if (!inactive) continue
        // In the tab's own colour: a cell has one foreground, and the side
        // meeting the line reads as the tab's, not the window's.
        buffer.drawText(inactive.flushLeft ? '├' : '┴', inactive.left, inactive.borderY, inactiveForeground, background)
        buffer.drawText('┴', inactive.right, inactive.borderY, inactiveForeground, background)
      }
      buffer.drawText('╭' + '─'.repeat(connection.right - connection.left - 1) + '╮', connection.left, connection.topY, foreground, background)
      buffer.drawText('│', connection.left, connection.tabY, foreground, background)
      buffer.drawText('│', connection.right, connection.tabY, foreground, background)
      buffer.drawText((connection.flushLeft ? '│' : '╯') + ' '.repeat(connection.right - connection.left - 1) + '╰', connection.left, connection.borderY, foreground, background)
    }
    renderer.addPostProcessFn(paint)
    return () => { renderer.removePostProcessFn(paint) }
  }, [renderer, props.enabled])
  return null
}
