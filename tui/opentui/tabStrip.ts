import { fitText } from './textLayout'
import type { ViewSpec, ViewTabStyle } from '../viewSpec'
import { NERD_FONT_ICONS, SEGMENT_CAPS } from './icons'

type ViewTabHover = ViewSpec['tabHover']

/** Tab styles whose outer cells are painted with Nerd Font glyphs. */
const TAB_SEGMENT_CAPS = {
  powerline: SEGMENT_CAPS.powerline,
  bubbles: SEGMENT_CAPS.diamond,
  slant: SEGMENT_CAPS.slant,
  pixel: SEGMENT_CAPS.pixel,
  flame: SEGMENT_CAPS.flame,
} as const

export function tabSegmentCaps(style: ViewTabStyle | 'standard' | undefined) {
  return style && style in TAB_SEGMENT_CAPS ? TAB_SEGMENT_CAPS[style as keyof typeof TAB_SEGMENT_CAPS] : null
}

/** The strip's rows: the tabs, plus a row above them only for the styles that
 * draw there — a raised tab's top edge, or a hover mark above the tab. */
export function horizontalTabBarHeight(style: ViewTabStyle, hover: ViewTabHover): 1 | 2 {
  if (style === 'chrome' || style === 'boxed' || style === 'windows') return 2
  return hover === (tabSegmentCaps(style) ? 'underline' : 'raise') ? 2 : 1
}

const CLOSE_SUFFIX = ' ×'
const NERD_CLOSE_SUFFIX = ` ${NERD_FONT_ICONS.error}`

function tabCloseSuffix(name: string): string {
  return name.endsWith(CLOSE_SUFFIX) ? CLOSE_SUFFIX : name.endsWith(NERD_CLOSE_SUFFIX) ? NERD_CLOSE_SUFFIX : ''
}

export function tabHasClose(name: string): boolean {
  return tabCloseSuffix(name) !== ''
}

// Keep the activity cell inside the tab's text budget. Prepending it to an
// already padded name makes tab-select truncate the close button at the end.
// Only the selected tab is closable: an inactive one gives its × cells to the title.
export function tabStripName(label: string, tabWidth: number, activity = '', closable = true, truncate: TabTruncate = 'end', closeIcon = '×'): string {
  const suffix = closable ? ` ${closeIcon}` : ''
  const budget = Math.max(1, tabWidth - 2 - suffix.length - (activity ? 2 : 0))
  const fitted = truncate === 'middle' ? fitTextMiddle(label, budget) : fitText(label, budget)
  return `${activity ? `${activity} ` : ''}${fitted}${suffix}`
}

export type TabTruncate = 'end' | 'middle'

/** Cut a label in its middle, so a title's last words survive beside its folder. */
export function fitTextMiddle(value: string, width: number): string {
  if (width <= 0) return ''
  if (value.length <= width) return value.padEnd(width, ' ')
  if (width < 5) return fitText(value, width)
  const head = Math.ceil((width - 1) / 2)
  const tail = width - 1 - head
  return `${value.slice(0, head).trimEnd()}…${value.slice(value.length - tail).trimStart()}`.padEnd(width, ' ')
}

/** A strip name's label, without its padding or close button. */
export function tabStripLabel(name: string): string {
  const suffix = tabCloseSuffix(name)
  return (suffix ? name.slice(0, -suffix.length) : name).trimEnd()
}

export function tabStripActivity(name: string, tabWidth: number, activity: string, truncate: TabTruncate = 'end'): string {
  const suffix = tabCloseSuffix(name)
  return tabStripName(tabStripLabel(name), tabWidth, activity, Boolean(suffix), truncate, suffix.trim())
}

// The connected outline must finish before the window title controls.
export function tabStripWidth(readerAreaWidth: number): number {
  return Math.max(readerAreaWidth - 24, 1)
}

/** ` ▾ ` (the tab list) before the tabs and ` + ` (new session) after them, as Chrome's strip. */
export const TAB_STRIP_BUTTON_WIDTH = 3

/** The cells the tabs themselves share, once both strip buttons have theirs. */
export function tabStripTabsWidth(readerAreaWidth: number): number {
  return Math.max(tabStripWidth(readerAreaWidth) - 2 * TAB_STRIP_BUTTON_WIDTH, 1)
}
