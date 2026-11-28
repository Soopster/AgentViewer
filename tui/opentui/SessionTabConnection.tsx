/** @jsxImportSource @opentui/react */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useRenderer } from '@opentui/react'
import { TextAttributes, parseColor, type BoxRenderable, type RGBA, type TabSelectRenderable } from '@opentui/core'
import type { ViewTabStyle } from '../viewSpec'
import { tabCloseSuffix, tabPaintWidth, tabSegmentCaps } from './tabStrip'

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
const tabPointers = new WeakMap<TabSelectRenderable, number>()

function tabScrollOffset(tabs: TabSelectRenderable): number {
  return (tabs as unknown as { scrollOffset: number }).scrollOffset ?? 0
}

function visibleTabCount(tabs: TabSelectRenderable): number {
  return Math.max(1, Math.floor(tabs.width / tabs.getTabWidth()))
}

/** The tab index a strip column falls in, or null outside every tab. */
export function tabIndexAt(tabs: TabSelectRenderable, x: number): number | null {
  const column = x - tabs.x
  if (column < 0 || column >= tabs.width) return null
  const slot = Math.floor(column / tabs.getTabWidth())
  if (slot >= visibleTabCount(tabs)) return null
  const index = tabScrollOffset(tabs) + slot
  return index < tabs.options.length ? index : null
}

function bubbleCloseColumn(tabs: TabSelectRenderable, index: number): number | null {
  const slotWidth = tabs.getTabWidth()
  const left = tabs.x + (index - tabScrollOffset(tabs)) * slotWidth
  const width = tabPaintWidth('bubbles', Math.min(slotWidth, tabs.x + tabs.width - left))
  return width >= 5 ? left + width - 2 : null
}

/** Match the visible close glyph, including one revealed by hovering an inactive bubble. */
export function bubbleTabCloseHit(tabs: TabSelectRenderable | null, x: number, enabled: boolean): boolean {
  if (!tabs || !enabled) return false
  const index = tabIndexAt(tabs, x)
  if (index === null || x !== bubbleCloseColumn(tabs, index)) return false
  return tabCloseSuffix(tabs.options[index]!.name) !== '' || hoveredTabIndex(tabs) === index
}

/** Record the pointer over a strip (null when it leaves). */
export function noteTabStripHover(tabs: TabSelectRenderable | null, x: number | null, trackClose = false) {
  if (!tabs) return
  const previousX = tabPointers.get(tabs)
  const previousIndex = hoveredTabIndex(tabs)
  const close = previousIndex !== null && trackClose ? bubbleCloseColumn(tabs, previousIndex) : null
  if (x === null) tabPointers.delete(tabs)
  else tabPointers.set(tabs, x)
  if (previousIndex !== hoveredTabIndex(tabs) || (close !== null && (x === close) !== (previousX === close))) tabs.requestRender()
}

export function hoveredTabIndex(tabs: TabSelectRenderable): number | null {
  const x = tabPointers.get(tabs)
  return x === undefined ? null : tabIndexAt(tabs, x)
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
  bubbleHoverBackground?: string
  bubbleClose?: { icon: string; hoverColor: string }
  /** The active tab in the `pills` style. */
  pillForeground?: string
  pillBackground?: string
  /** How the strip draws (tui/viewSpec.ts `tabStyle`); Chrome's raised tab by default. */
  tabStyle?: ViewTabStyle
  highlightSelected?: boolean
  segmentBackground?: string
  /** Thin rules between inactive tabs. */
  separators?: boolean
  /** How an inactive tab under the pointer is marked (tui/viewSpec.ts `tabHover`). */
  hover?: 'tint' | 'pill' | 'raise' | 'underline' | 'text' | 'accent' | 'none'
  /** The active tab's fill in the `windows` style. */
  windowsBackground?: string
  /** Inactive tabs' faint fill in the `windows` style; each tab's last cell stays strip, as a gap. */
  windowsInactiveBackground?: string
  /** Inactive tabs' label colour when the painter redraws them (the strip's own text colour). */
  inactiveLabel?: string
  /** Per tab value, the colour its provider initial is painted in (`tabAccent: 'all'`). */
  initialColors?: ReadonlyMap<string, string> | null
}) {
  const renderer = useRenderer()
  const latest = useRef(props)
  const colors = useMemo(() => ({
    foreground: parseColor(props.foreground), background: parseColor(props.background),
    inactiveForeground: parseColor(props.inactiveForeground), inactiveBackground: parseColor(props.inactiveBackground),
    hoverForeground: parseColor(props.hoverForeground), hoverBackground: parseColor(props.hoverBackground),
    bubbleHoverBackground: parseColor(props.bubbleHoverBackground ?? props.hoverBackground),
    closeHoverColor: parseColor(props.bubbleClose?.hoverColor ?? props.hoverForeground),
    pillForeground: parseColor(props.pillForeground ?? props.hoverForeground), pillBackground: parseColor(props.pillBackground ?? props.hoverBackground),
    windowsBackground: parseColor(props.windowsBackground ?? props.pillBackground ?? props.hoverBackground),
    windowsInactiveBackground: parseColor(props.windowsInactiveBackground ?? props.inactiveBackground),
    segmentBackground: parseColor(props.segmentBackground ?? props.hoverBackground),
    inactiveLabel: parseColor(props.inactiveLabel ?? props.hoverForeground),
    initials: new Map([...(props.initialColors ?? new Map<string, string>())].map(([key, color]) => [key, parseColor(color)] as const)),
  }), [props.foreground, props.background, props.inactiveForeground, props.inactiveBackground, props.hoverForeground, props.hoverBackground, props.bubbleHoverBackground, props.bubbleClose?.hoverColor, props.pillForeground, props.pillBackground, props.windowsBackground, props.windowsInactiveBackground, props.segmentBackground, props.inactiveLabel, props.initialColors])
  const palette = useRef(colors)
  useLayoutEffect(() => { latest.current = props; palette.current = colors })
  useEffect(() => {
    if (!props.enabled) return
    const paint = (buffer: Parameters<Parameters<typeof renderer.addPostProcessFn>[0]>[0]) => {
      const current = latest.current
      if (!current.enabled) return
      const tabs = current.tabs.current
      if (!tabs || !tabs.visible) return
      // A floating panel over the strip (the View Studio) keeps its cells: this
      // pass runs after the frame, so without clipping it draws through them.
      const paintRanges = (x: number, width: number, y: number) => {
        let ranges: Array<[number, number]> = [[x, x + width]]
        for (const read of TAB_PAINT_OCCLUDERS) {
          const rect = read()
          if (!rect || y < rect.y || y >= rect.y + rect.height) continue
          ranges = ranges.flatMap(([from, to]): Array<[number, number]> => [[from, Math.min(to, rect.x)], [Math.max(from, rect.x + rect.width), to]].filter(([l, r]) => r > l) as Array<[number, number]>)
        }
        return ranges
      }
      const drawText = (text: string, x: number, y: number, fg: RGBA, bg: RGBA, attributes = 0) => {
        for (const [from, to] of paintRanges(x, text.length, y)) buffer.drawText(text.slice(from - x, to - x), from, y, fg, bg, attributes)
      }
      const { foreground, background, inactiveForeground, inactiveBackground, hoverForeground, hoverBackground, bubbleHoverBackground, closeHoverColor, pillForeground, pillBackground, windowsBackground, windowsInactiveBackground, inactiveLabel, initials } = palette.current
      const hoverStyle = current.hover ?? 'tint'
      const style = current.tabStyle ?? 'chrome'
      const tabWidth = tabs.getTabWidth()
      // Chrome's strip: inactive tabs have no outline, only a muted separator
      // between two of them (none beside the selected tab, none after the
      // last). Only the selected tab is raised, and it opens into the window.
      const offset = tabScrollOffset(tabs)
      const selected = tabs.getSelectedIndex()
      const hovered = hoveredTabIndex(tabs)
      const active = current.highlightSelected === false ? -1 : selected
      const lifted = hovered !== null && hovered !== active && hoverStyle !== 'none' ? hovered : null
      const caps = tabSegmentCaps(style)
      if (caps) {
        if (tabs.x < 0 || tabs.y < 0 || tabs.y >= buffer.height || tabs.x + tabs.width > buffer.width) return
        const end = Math.min(tabs.options.length, offset + visibleTabCount(tabs))
        const bubbles = style === 'bubbles'
        const hoverPill = hoverStyle === 'pill' ? lifted : null
        const fill = (index: number) => {
          if (index === active) return pillBackground
          if (index === lifted && (hoverStyle === 'tint' || hoverStyle === 'pill' || hoverStyle === 'raise')) return bubbles ? bubbleHoverBackground : hoverBackground
          if (caps.joined && index % 2 !== 0) return windowsInactiveBackground
          return palette.current.segmentBackground
        }
        for (let index = offset; index < end; index++) {
          const x = tabs.x + (index - offset) * tabWidth
          const slotWidth = Math.min(tabWidth, tabs.x + tabs.width - x)
          const width = tabPaintWidth(style, slotWidth)
          if (width < 4) continue
          const y = tabs.y
          const bg = fill(index)
          const fg = index === active ? pillForeground
            : index === lifted ? (hoverStyle === 'accent' ? foreground : hoverForeground)
            : bubbles ? inactiveLabel : hoverForeground
          const bold = (bubbles && index === active) || (index === lifted && hoverStyle === 'text')
          const attributes = bold ? TextAttributes.BOLD : 0
          const option = tabs.options[index]!
          const previous = index > offset
          const next = index + 1 < end
          const right = x + width - 1
          const suffix = bubbles && current.bubbleClose ? tabCloseSuffix(option.name) : ''
          const closeColumn = bubbles && current.bubbleClose && (suffix || index === hovered) ? bubbleCloseColumn(tabs, index) : null
          const label = suffix ? option.name.slice(0, -suffix.length) : option.name
          const labelWidth = width - (closeColumn === null ? 2 : 4)
          drawText(' '.repeat(width - 2), x + 1, y, fg, bg)
          // Keep fitting in terminal cells, including when an overlay clips a wide title.
          for (const [from, to] of paintRanges(x + 1, labelWidth, y)) {
            buffer.pushScissorRect(from, y, to - from, 1)
            try { buffer.drawTextFit(label, x + 1, y, labelWidth, fg, bg, true) }
            finally { buffer.popScissorRect() }
            // drawTextFit has no attributes parameter. Keep its native grapheme fitting.
            if (bold) buffer.withBuffers(cells => {
              for (let column = from; column < to; column++) cells.attributes[y * cells.width + column] |= attributes
            })
          }
          const provider = index !== active ? initials.get(String(option.value)) : undefined
          const initial = provider && /(?:^|\s)([A-Z]) /.exec(label)
          if (initial && initial.index <= 8) {
            const column = x + initial.index + initial[0].length - 1
            if (column < x + 1 + labelWidth) drawText(initial[1]!, column, y, provider!, bg, attributes)
          }
          if (closeColumn !== null && current.bubbleClose) {
            const closeFg = tabPointers.get(tabs) === closeColumn ? closeHoverColor : hoverForeground
            drawText(suffix.trim() || current.bubbleClose.icon, closeColumn, y, closeFg, bg, attributes)
          }
          if (index === lifted && y > 0) {
            if (hoverStyle === 'underline') drawText('━'.repeat(width - 2), x + 1, y - 1, foreground, inactiveBackground)
            if (hoverStyle === 'raise') drawText(`╭${'─'.repeat(width - 2)}╮`, x, y - 1, inactiveForeground, inactiveBackground)
          }
          // The native scroll arrows occupy the outermost cells of the strip.
          if (!(tabs.showScrollArrows && !previous && offset > 0)) {
            if (index === hoverPill) drawText('▐', x, y, bg, inactiveBackground)
            else if (caps.joined && previous && index - 1 !== hoverPill) drawText(' ', x, y, fg, bg)
            else drawText(caps.left, x, y, bg, inactiveBackground)
          }
          const lastColumn = x + slotWidth - 1
          const rightArrow = tabs.showScrollArrows && end < tabs.options.length && lastColumn === tabs.x + tabs.width - 1
          if (bubbles && !rightArrow) drawText(' ', lastColumn, y, inactiveLabel, inactiveBackground)
          if (bubbles || !rightArrow) {
            if (index === hoverPill) drawText('▌', right, y, bg, inactiveBackground)
            else drawText(caps.right, right, y, bg, caps.joined && next && index + 1 !== hoverPill ? fill(index + 1) : inactiveBackground)
          }
        }
        return
      }
      const frame = current.readWindow()
      if (!frame || !frame.visible || tabs.getSelectedOption()?.value !== current.ownerKey) return
      const connection = tabConnectionGeometry(tabs, frame, selected, offset, tabWidth)
      if (!connection || connection.left < 0 || connection.tabY < 0 || connection.borderY >= buffer.height || connection.borderEnd >= buffer.width) return
      // A covering overlay must not acquire a hole in its own border/content.
      const uncovered = buffer.withBuffers(cells => ['┌', '╭'].some(c => cells.char[frame.y * cells.width + frame.x] === c.codePointAt(0)))
      if (!uncovered) return
      drawText('─'.repeat(connection.borderEnd - connection.borderStart), connection.borderStart, connection.borderY, foreground, background)
      // Boxed tabs carry their own sides, so they need no separators; Windows
      // Terminal's strip has none either, the filled tab is the only shape.
      for (let index = offset; current.separators !== false && style !== 'boxed' && style !== 'windows' && index < tabs.options.length - 1; index++) {
        if ((index - offset + 2) * tabs.getTabWidth() > tabs.width) break
        // Like Chrome, a separator also gives way beside the hovered tab.
        if (index === selected || index + 1 === selected || index === lifted || index + 1 === lifted) continue
        const inactive = tabConnectionGeometry(tabs, frame, index, offset, tabs.getTabWidth())
        if (inactive) drawText('│', inactive.right, inactive.tabY, inactiveForeground, inactiveBackground)
      }
      const hover = lifted === null ? null : tabConnectionGeometry(tabs, frame, lifted, offset, tabs.getTabWidth())
      const hoverName = lifted === null ? '' : tabs.options[lifted]?.name ?? ''
      if (style === 'windows') {
        // Windows Terminal's inactive tabs are faint blocks, one strip-coloured
        // cell apart, so neighbouring titles do not run together.
        for (let index = offset; index < tabs.options.length; index++) {
          if ((index - offset + 1) * tabWidth > tabs.width) break
          if (index === selected) continue
          const tab = tabConnectionGeometry(tabs, frame, index, offset, tabWidth)
          if (!tab || tab.right - tab.left < 2) continue
          const filled = index === lifted && (hoverStyle === 'tint' || hoverStyle === 'pill' || hoverStyle === 'raise')
          const fill = filled ? hoverBackground : windowsInactiveBackground
          drawText(' '.repeat(tab.right - tab.left), tab.left, tab.tabY, inactiveForeground, fill)
          drawText((tabs.options[index]?.name ?? '').slice(0, tab.right - tab.left - 1), tab.left + 1, tab.tabY, filled ? hoverForeground : inactiveLabel, fill)
        }
      }
      if (hover && lifted !== null && hover.right - hover.left >= 2 && !(style === 'windows' && (hoverStyle === 'tint' || hoverStyle === 'pill' || hoverStyle === 'raise'))) {
        if ((style === 'pills' && hoverStyle === 'tint') || hoverStyle === 'pill') {
          // A pill like the active one, its caps on the strip's own colour so the ends stay clean.
          drawText('▐', hover.left, hover.tabY, hoverBackground, inactiveBackground)
          drawText(' '.repeat(hover.right - hover.left - 1), hover.left + 1, hover.tabY, hoverForeground, hoverBackground)
          drawText(hoverName, hover.left + 1, hover.tabY, hoverForeground, hoverBackground)
          drawText('▌', hover.right, hover.tabY, hoverBackground, inactiveBackground)
        } else if (hoverStyle === 'tint') {
          // A flat fill across the whole tab: no half-block caps, which a font
          // draws with seams and which left the pill looking sunk into the strip.
          // Boxed tabs keep their walls: the fill stays inside them.
          if (style === 'boxed') drawText(' '.repeat(hover.right - hover.left - 1), hover.left + 1, hover.tabY, hoverForeground, hoverBackground)
          else drawText(' '.repeat(hover.right - hover.left + 1), hover.left, hover.tabY, hoverForeground, hoverBackground)
          drawText(hoverName.slice(0, hover.right - hover.left - 1), hover.left + 1, hover.tabY, hoverForeground, hoverBackground)
        } else if (hoverStyle === 'raise') {
          // The active tab's outline in the muted colour, standing on the border rather than opening into it.
          drawText('╭' + '─'.repeat(hover.right - hover.left - 1) + '╮', hover.left, hover.topY, inactiveForeground, inactiveBackground)
          drawText('│', hover.left, hover.tabY, inactiveForeground, inactiveBackground)
          drawText(' '.repeat(hover.right - hover.left - 1), hover.left + 1, hover.tabY, hoverForeground, hoverBackground)
          drawText(hoverName, hover.left + 1, hover.tabY, hoverForeground, hoverBackground)
          drawText('│', hover.right, hover.tabY, inactiveForeground, inactiveBackground)
        } else if (hoverStyle === 'text' || hoverStyle === 'accent') {
          // Only the label changes: brighter and bold, or in the accent colour.
          drawText(hoverName, hover.left + 1, hover.tabY, hoverStyle === 'accent' ? foreground : hoverForeground, inactiveBackground, hoverStyle === 'text' ? TextAttributes.BOLD : 0)
        } else if (hoverStyle === 'underline') {
          drawText('━'.repeat(hover.right - hover.left + 1), hover.left, hover.borderY, inactiveForeground, background)
          drawText(hoverName, hover.left + 1, hover.tabY, hoverForeground, inactiveBackground)
        }
      }
      // Provider initials in their provider's colour (`tabAccent: 'all'`). The
      // initial is the first lone capital the label carries: numbers, the pin
      // and the activity glyph come before it, the title after.
      if (initials.size > 0) {
        for (let index = offset; index < tabs.options.length; index++) {
          if ((index - offset + 1) * tabWidth > tabs.width) break
          const option = tabs.options[index]
          const color = option?.value != null ? initials.get(String(option.value)) : undefined
          // The active tab's whole label already carries the accent.
          if (!option || !color || index === selected) continue
          const match = /(?:^|\s)([A-Z]) /.exec(option.name)
          if (!match || match.index > 8) continue
          const tab = tabConnectionGeometry(tabs, frame, index, offset, tabWidth)
          if (!tab) continue
          const column = tab.left + 1 + match.index + (match[0].length - 2)
          if (column >= tab.right) continue
          const cellBackground = index === lifted && (hoverStyle === 'tint' || hoverStyle === 'pill' || hoverStyle === 'raise') ? hoverBackground : style === 'windows' ? windowsInactiveBackground : inactiveBackground
          drawText(match[1]!, column, tab.tabY, color, cellBackground)
        }
      }
      const inner = connection.right - connection.left - 1
      if (style === 'boxed') {
        // Every tab outlined, inactive ones in the muted colour, standing on the
        // border. Neighbours share one wall: a tab draws its left side only when
        // it is the first shown (otherwise the tab before supplies it), and its
        // right side only when the next is not the active tab, which draws its
        // own. Two inactive walls meeting at the top join as ┬.
        const visible = (index: number) => index >= offset && (index - offset + 1) * tabWidth <= tabs.width
        for (let index = offset; index < tabs.options.length; index++) {
          if (!visible(index)) break
          if (index === selected) continue
          const tab = tabConnectionGeometry(tabs, frame, index, offset, tabWidth)
          if (!tab) continue
          const drawLeft = index === offset
          const drawRight = index + 1 !== selected
          const joinsNext = drawRight && index + 1 < tabs.options.length && visible(index + 1)
          const top = (drawLeft ? '╭' : '─') + '─'.repeat(tab.right - tab.left - 1) + (drawRight ? (joinsNext ? '┬' : '╮') : '─')
          drawText(top, tab.left, tab.topY, inactiveForeground, inactiveBackground)
          if (drawLeft) {
            drawText('│', tab.left, tab.tabY, inactiveForeground, inactiveBackground)
            drawText(tab.flushLeft ? '├' : '┴', tab.left, tab.borderY, foreground, background)
          }
          if (drawRight) {
            drawText('│', tab.right, tab.tabY, inactiveForeground, inactiveBackground)
            drawText('┴', tab.right, tab.borderY, foreground, background)
          }
        }
      }
      if (style === 'chrome' || style === 'boxed') {
        drawText('╭' + '─'.repeat(inner) + '╮', connection.left, connection.topY, foreground, background)
        drawText('│', connection.left, connection.tabY, foreground, background)
        drawText('│', connection.right, connection.tabY, foreground, background)
        drawText((connection.flushLeft ? '│' : '╯') + ' '.repeat(inner) + '╰', connection.left, connection.borderY, foreground, background)
      } else if (style === 'underline') {
        // A heavy rule on the window's border, under the active tab alone.
        drawText('━'.repeat(inner + 2), connection.left, connection.borderY, foreground, background)
      } else if (style === 'pills' && inner >= 1) {
        drawText('▐', connection.left, connection.tabY, pillBackground, inactiveBackground)
        drawText(' '.repeat(inner), connection.left + 1, connection.tabY, pillForeground, pillBackground)
        drawText(tabs.options[selected]?.name ?? '', connection.left + 1, connection.tabY, pillForeground, pillBackground)
        drawText('▌', connection.right, connection.tabY, pillBackground, inactiveBackground)
      } else if (style === 'windows' && inner >= 1) {
        // Windows Terminal: the active tab is the window's own colour, with no
        // separators around it. Its outline is one line in the accent: the top
        // edge turns down into the sides, and the sides turn out into the window
        // border, so tab and window read as one surface.
        drawText('╭' + '─'.repeat(inner) + '╮', connection.left, connection.topY, foreground, inactiveBackground)
        drawText(' '.repeat(inner), connection.left + 1, connection.tabY, pillForeground, windowsBackground)
        drawText(tabs.options[selected]?.name ?? '', connection.left + 1, connection.tabY, pillForeground, windowsBackground)
        drawText('│', connection.left, connection.tabY, foreground, windowsBackground)
        drawText('│', connection.right, connection.tabY, foreground, windowsBackground)
        drawText((connection.flushLeft ? '│' : '╯') + ' '.repeat(inner) + '╰', connection.left, connection.borderY, foreground, background)
      }
      // `minimal`: the label's colour is the only mark.
    }
    renderer.addPostProcessFn(paint)
    return () => { renderer.removePostProcessFn(paint) }
  }, [renderer, props.enabled])
  return null
}
