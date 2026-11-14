// What a script may do to the TUI's windows, behind the control socket
// (`agent-viewer terminal windows|window`). The windows live in React state in
// this process, so the App registers a bridge that answers from it; with no App
// mounted (a smoke, a headless run) there is none and the socket says so.
//
// The set is deliberately the window menu's own: a script can do what a user's
// menu does, no more. Every action goes through the same `runWindowControlAction`.

import type { WindowControlAction } from './windowControls'

export type ScriptedWindow = { number: number; key: string; title: string; focused: boolean }
export type WindowBridge = {
  list: () => ScriptedWindow[]
  /** Run a menu action on a window; false when that window is gone. */
  act: (key: string, action: WindowControlAction) => boolean
  /** Apply a layout-menu arrangement (`two`, `main-stack`, `grid`, `grid-six`, `fill`, `fullscreen`). */
  arrange: (arrangement: string) => void
}

/** The menu actions a script may run: the ones that are one decision about one window. */
export const SCRIPTABLE_WINDOW_ACTIONS: readonly WindowControlAction[] = [
  'focus', 'zoom', 'fullscreen', 'float', 'tab', 'detach', 'split-columns', 'split-rows', 'close', 'close-others', 'equalize', 'undo',
]
export const SCRIPTABLE_ARRANGEMENTS = ['two', 'main-stack', 'grid', 'grid-six', 'fill', 'fullscreen'] as const

let bridge: WindowBridge | null = null
export function registerWindowBridge(next: WindowBridge | null): void { bridge = next }
export function getWindowBridge(): WindowBridge | null { return bridge }

/** A window by its number (`2`) or its key (`surface:terminal`). */
export function resolveScriptedWindow(windows: readonly ScriptedWindow[], target: string): ScriptedWindow | null {
  const number = /^\d+$/.test(target) ? Number(target) : null
  return windows.find((window) => (number !== null ? window.number === number : window.key === target)) ?? null
}
