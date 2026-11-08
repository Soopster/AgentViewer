import { fitText } from './textLayout'

export const HORIZONTAL_TAB_BAR_HEIGHT = 2

const CLOSE_SUFFIX = ' ×'

// Keep the activity cell inside the tab's text budget. Prepending it to an
// already padded name makes tab-select truncate the close button at the end.
// Only the selected tab is closable: an inactive one gives its × cells to the title.
export function tabStripName(label: string, tabWidth: number, activity = '', closable = true): string {
  const budget = Math.max(1, tabWidth - 2 - (closable ? CLOSE_SUFFIX.length : 0) - (activity ? 2 : 0))
  return `${activity ? `${activity} ` : ''}${fitText(label, budget)}${closable ? CLOSE_SUFFIX : ''}`
}

/** A strip name's label, without its padding or close button. */
export function tabStripLabel(name: string): string {
  return (name.endsWith(CLOSE_SUFFIX) ? name.slice(0, -CLOSE_SUFFIX.length) : name).trimEnd()
}

export function tabStripActivity(name: string, tabWidth: number, activity: string): string {
  return tabStripName(tabStripLabel(name), tabWidth, activity, name.endsWith(CLOSE_SUFFIX))
}

// The connected outline must finish before the window title controls.
export function tabStripWidth(readerAreaWidth: number): number {
  return Math.max(readerAreaWidth - 24, 1)
}
