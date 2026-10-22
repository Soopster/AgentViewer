import type { ReactNode } from 'react'

// Chrome the root draws around the transcript being read — the view header,
// context meter, fleet strip, banners and search above it; the turn status,
// idle ticker and CHAT's composer bar below — rendered inside whichever window
// shows that transcript. A store rather than a prop: the chrome changes with
// every root render, and as a prop it would re-render every transcript window
// with it; subscribed, it re-renders the outlet alone.
export type WindowChrome = {
  /** Rows the chrome takes from the window. */
  rows: number
  render: (width: number) => ReactNode
}

export type WindowChromeStore = {
  get: () => WindowChrome | null
  set: (next: WindowChrome | null) => void
  subscribe: (listener: () => void) => () => void
}

function createWindowChromeStore(): WindowChromeStore {
  let current: WindowChrome | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: (next) => {
      if (next === current) return
      current = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export const selectedWindowHeader = createWindowChromeStore()
export const selectedWindowFooter = createWindowChromeStore()
