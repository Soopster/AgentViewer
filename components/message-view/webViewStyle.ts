'use client'
// What the shown view changes about the web's drawing. Only fields a view
// changes from its base are published, so the built-in views keep the web's own
// look. Components read them with `useWebViewStyle`; plain styling is done in
// app/view-style.css from the matching `data-view-*` attributes on <html>.
import { useSyncExternalStore } from 'react'
import type { ViewSpec, ViewSpecKey } from '@/tui/viewSpec'

export type WebViewStyle = Partial<ViewSpec>

/** Fields drawn through this store (the rest of the web's fields set its display settings). */
export const WEB_STYLE_FIELDS = [
  'composer', 'composerStatus', 'composerBorder', 'composerSize',
  'stripBadge', 'stripSeparator', 'stripColor', 'stripLabels', 'stripContextStyle', 'stripOrder', 'stripFolderStyle', 'stripLimits', 'stripPr', 'stripTokens', 'stripCache', 'stripLines', 'stripDuration', 'stripRows', 'stripModel', 'stripEffort', 'stripContext', 'stripCost', 'stripFolder', 'stripGit', 'stripHints',
  'showThinking', 'showSubagents', 'turnBoundaries', 'thinking',
  'promptMarker', 'replyMarker', 'markerColor', 'promptBand', 'promptRule', 'userBold', 'toolRows', 'diffPreview',
  'tabs', 'tabStyle', 'tabWidth', 'tabClose', 'tabNumbers', 'tabSeparators', 'tabTitle', 'tabStripFill', 'tabHover', 'tabAccent', 'tabTruncate',
  'railFill', 'transcriptFill', 'composerFill',
  'messageLayout', 'promptTimestamps', 'replyTimestamps', 'turnFooter', 'completedTurnHint', 'liveReasoning', 'scrollbar',
  'tabIcons', 'borders', 'borderTheme', 'showToolCalls', 'sidebarView', 'sidePanel',
] as const satisfies readonly ViewSpecKey[]

/** Fired when a view is applied that asks for a rail tab or a side panel: those are entered, not held. */
export const WEB_VIEW_PANELS_EVENT = 'agent-viewer:view-panels'
export type WebViewPanelsDetail = Pick<ViewSpec, 'sidebarView' | 'sidePanel'>

const STORAGE_KEY = 'agentViewer:viewStyle'
const NONE: WebViewStyle = {}
let current: WebViewStyle = NONE
let loaded = false
const listeners = new Set<() => void>()

const attributeName = (key: string) => `data-view-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

function writeAttributes(style: WebViewStyle) {
  for (const key of WEB_STYLE_FIELDS) {
    const value = style[key]
    if (value === undefined || value === null) document.documentElement.removeAttribute(attributeName(key))
    else document.documentElement.setAttribute(attributeName(key), String(value))
  }
}

export function webViewStyleOf(spec: ViewSpec, base: ViewSpec): WebViewStyle {
  const style: Record<string, unknown> = {}
  for (const key of WEB_STYLE_FIELDS) if (spec[key] !== base[key]) style[key] = spec[key]
  return style as WebViewStyle
}

export function publishWebViewStyle(style: WebViewStyle) {
  loaded = true
  if (JSON.stringify(style) === JSON.stringify(current)) { writeAttributes(current); return }
  current = style
  writeAttributes(style)
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(style)) } catch { /* private mode */ }
  for (const listener of listeners) listener()
}

/** The last published style, restored on first use so a reload does not wait for the view library. */
function restore() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>
    current = Object.fromEntries(WEB_STYLE_FIELDS.filter((key) => key in stored).map((key) => [key, stored[key]])) as WebViewStyle
    writeAttributes(current)
  } catch { /* unreadable storage keeps the native look */ }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!loaded) { restore(); listener() }
  return () => { listeners.delete(listener) }
}

export function useWebViewStyle(): WebViewStyle {
  return useSyncExternalStore(subscribe, () => current, () => NONE)
}
