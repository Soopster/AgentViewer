import { fitText } from './textLayout'

// Keep the activity cell inside the tab's text budget. Prepending it to an
// already padded name makes tab-select truncate the close button at the end.
export function tabStripName(label: string, tabWidth: number, activity = ''): string {
  return `${activity ? `${activity} ` : ''}${fitText(label, Math.max(1, tabWidth - 4 - (activity ? 2 : 0)))} ×`
}

export function tabStripActivity(name: string, tabWidth: number, activity: string): string {
  return tabStripName(name.slice(0, -2).trimEnd(), tabWidth, activity)
}

// The connected outline must finish before the window title controls.
export function tabStripWidth(readerAreaWidth: number): number {
  return Math.max(readerAreaWidth - 24, 1)
}
