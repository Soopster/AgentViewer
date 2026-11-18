import { fitText } from './textLayout'

export const HORIZONTAL_TAB_BAR_HEIGHT = 2

const CLOSE_SUFFIX = ' ×'

// Keep the activity cell inside the tab's text budget. Prepending it to an
// already padded name makes tab-select truncate the close button at the end.
// Only the selected tab is closable: an inactive one gives its × cells to the title.
export function tabStripName(label: string, tabWidth: number, activity = '', closable = true, truncate: TabTruncate = 'end'): string {
  const budget = Math.max(1, tabWidth - 2 - (closable ? CLOSE_SUFFIX.length : 0) - (activity ? 2 : 0))
  const fitted = truncate === 'middle' ? fitTextMiddle(label, budget) : fitText(label, budget)
  return `${activity ? `${activity} ` : ''}${fitted}${closable ? CLOSE_SUFFIX : ''}`
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
  return (name.endsWith(CLOSE_SUFFIX) ? name.slice(0, -CLOSE_SUFFIX.length) : name).trimEnd()
}

export function tabStripActivity(name: string, tabWidth: number, activity: string, truncate: TabTruncate = 'end'): string {
  return tabStripName(tabStripLabel(name), tabWidth, activity, name.endsWith(CLOSE_SUFFIX), truncate)
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
