// Cards whose clipped tool output is shown in full. Module-level so the `o` key
// (reader keys) and the card's own click target share one switch without
// threading a prop through every window.
import { useSyncExternalStore } from 'react'

let shown: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

export function toggleFullToolOutput(cardKey: string): void {
  const next = new Set(shown)
  if (!next.delete(cardKey)) next.add(cardKey)
  shown = next
  for (const listener of listeners) listener()
}

export function useFullToolOutput(cardKey: string): boolean {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => shown.has(cardKey),
  )
}
