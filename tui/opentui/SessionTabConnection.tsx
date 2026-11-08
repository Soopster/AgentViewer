/** @jsxImportSource @opentui/react */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useRenderer } from '@opentui/react'
import { parseColor, type BoxRenderable, type RGBA, type TabSelectRenderable } from '@opentui/core'

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

// The tab under the pointer, per strip. Hover repaints the strip alone (the
// painter below reads it): routing it through React state would re-render the
// root, mounted transcript included, on every mouse move across the tabs.
const hoveredTabs = new WeakMap<TabSelectRenderable, number>()

/** The tab index a strip column falls in, or null outside every tab. */
export function tabIndexAt(tabs: TabSelectRenderable, x: number): number | null {
  const column = x - tabs.x
  if (column < 0 || column >= tabs.width) return null
  const index = ((tabs as unknown as { scrollOffset: number }).scrollOffset ?? 0) + Math.floor(column / tabs.getTabWidth())
  return index < tabs.options.length ? index : null
}

/** Record the pointer over a strip (null when it leaves); repaints only on a change of tab. */
export function noteTabStripHover(tabs: TabSelectRenderable | null, x: number | null) {
  if (!tabs) return
  const index = x === null ? null : tabIndexAt(tabs, x)
  if ((hoveredTabs.get(tabs) ?? null) === index) return
  if (index === null) hoveredTabs.delete(tabs)
  else hoveredTabs.set(tabs, index)
  tabs.requestRender()
}

export function hoveredTabIndex(tabs: TabSelectRenderable): number | null {
  return hoveredTabs.get(tabs) ?? null
}

/** Native chrome only: no layout changes, timers, hit targets, or root updates.
 * Paint the cap, label sides and pane join using current native coordinates, so resize and tab
 * scrolling cannot leave a connector on yesterday's window. */
export type TabPaintOccluder = { x: number; y: number; width: number; height: number }
const TAB_PAINT_OCCLUDERS = new Set<() => TabPaintOccluder | null>()
/**
 * A panel drawn over the tab strip registers where it is, read at paint time
 * (after layout), so the outline pass leaves its cells alone.
 */
export function registerTabPaintOccluder(read: () => TabPaintOccluder | null): () => void {
  TAB_PAINT_OCCLUDERS.add(read)
  return () => { TAB_PAINT_OCCLUDERS.delete(read) }
}

export function SessionTabConnection(props: {
  tabs: React.RefObject<TabSelectRenderable | null>
  readWindow: () => BoxRenderable | null
  ownerKey: string | null
  enabled: boolean
  foreground: string
  background: string
  inactiveForeground: string
  inactiveBackground: string
  /** An inactive tab under the pointer: Chrome draws it as a tinted pill. */
  hoverForeground: string
  hoverBackground: string
}) {
  const renderer = useRenderer()
  const latest = useRef(props)
  const colors = useMemo(() => ({
    foreground: parseColor(props.foreground), background: parseColor(props.background),
    inactiveForeground: parseColor(props.inactiveForeground), inactiveBackground: parseColor(props.inactiveBackground),
    hoverForeground: parseColor(props.hoverForeground), hoverBackground: parseColor(props.hoverBackground),
  }), [props.foreground, props.background, props.inactiveForeground, props.inactiveBackground, props.hoverForeground, props.hoverBackground])
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
      // A floating panel over the strip (the View Studio) keeps its cells: this
      // pass runs after the frame, so without clipping it draws through them.
      const drawText = (text: string, x: number, y: number, fg: RGBA, bg: RGBA) => {
        let ranges: Array<[number, number]> = [[x, x + text.length]]
        for (const read of TAB_PAINT_OCCLUDERS) {
          const rect = read()
          if (!rect || y < rect.y || y >= rect.y + rect.height) continue
          ranges = ranges.flatMap(([from, to]): Array<[number, number]> => [[from, Math.min(to, rect.x)], [Math.max(from, rect.x + rect.width), to]].filter(([l, r]) => r > l) as Array<[number, number]>)
        }
        for (const [from, to] of ranges) buffer.drawText(text.slice(from - x, to - x), from, y, fg, bg)
      }
      const { foreground, background, inactiveForeground, inactiveBackground, hoverForeground, hoverBackground } = palette.current
      // Chrome's strip: inactive tabs have no outline, only a muted separator
      // between two of them (none beside the selected tab, none after the
      // last). Only the selected tab is raised, and it opens into the window.
      const offset = (tabs as unknown as { scrollOffset: number }).scrollOffset ?? 0
      const selected = tabs.getSelectedIndex()
      drawText('─'.repeat(connection.borderEnd - connection.borderStart), connection.borderStart, connection.borderY, foreground, background)
      const hovered = hoveredTabIndex(tabs)
      const lifted = hovered !== null && hovered !== selected ? hovered : null
      for (let index = offset; index < tabs.options.length - 1; index++) {
        if ((index - offset + 2) * tabs.getTabWidth() > tabs.width) break
        // Like Chrome, a separator also gives way beside the hovered tab.
        if (index === selected || index + 1 === selected || index === lifted || index + 1 === lifted) continue
        const inactive = tabConnectionGeometry(tabs, frame, index, offset, tabs.getTabWidth())
        if (inactive) drawText('│', inactive.right, inactive.tabY, inactiveForeground, inactiveBackground)
      }
      const hover = lifted === null ? null : tabConnectionGeometry(tabs, frame, lifted, offset, tabs.getTabWidth())
      if (hover && lifted !== null && hover.right - hover.left >= 2) {
        // Chrome's hover is a pill on the label row, inset from the tab's edges:
        // half blocks at each end round it, the cells between carry the label.
        drawText('▐', hover.left, hover.tabY, hoverBackground, inactiveBackground)
        drawText(' '.repeat(hover.right - hover.left - 1), hover.left + 1, hover.tabY, hoverForeground, hoverBackground)
        drawText(tabs.options[lifted]?.name ?? '', hover.left + 1, hover.tabY, hoverForeground, hoverBackground)
        drawText('▌', hover.right, hover.tabY, hoverBackground, inactiveBackground)
      }
      drawText('╭' + '─'.repeat(connection.right - connection.left - 1) + '╮', connection.left, connection.topY, foreground, background)
      drawText('│', connection.left, connection.tabY, foreground, background)
      drawText('│', connection.right, connection.tabY, foreground, background)
      drawText((connection.flushLeft ? '│' : '╯') + ' '.repeat(connection.right - connection.left - 1) + '╰', connection.left, connection.borderY, foreground, background)
    }
    renderer.addPostProcessFn(paint)
    return () => { renderer.removePostProcessFn(paint) }
  }, [renderer, props.enabled])
  return null
}
