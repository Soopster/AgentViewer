import type { ReactNode } from 'react'

// Chrome the root draws for the transcript being read — the CHAT and AGENTS
// views' composer bar — rendered inside whichever window shows that
// transcript. A store rather than a prop: the chrome changes with every root
// render, and as a prop it would re-render every transcript window with it;
// subscribed, it re-renders the outlet alone.
export type WindowChrome = {
  /** Rows the chrome takes from the bottom of the window. */
  rows: number
  render: (width: number) => ReactNode
}

let current: WindowChrome | null = null
const listeners = new Set<() => void>()

export const selectedWindowFooter = {
  get: (): WindowChrome | null => current,
  set: (next: WindowChrome | null) => {
    if (next === current) return
    current = next
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}
