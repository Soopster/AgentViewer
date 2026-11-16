// Which component draws a tool call. The host registers its native cards here
// (components/MessageItem.tsx) the same way a plugin registers its own, so a
// card is a registration, never a branch in the dispatcher. A later
// registration for a name wins and unregistering restores the previous one,
// which is how a plugin overrides or decorates a native card and then leaves.
import type { ComponentType } from 'react'
import type { ToolThread } from '@/lib/threading'

export type ToolCardComponent = ComponentType<{ thread: ToolThread }>
export type ToolCardMatch = readonly string[] | ((toolName: string) => boolean)

type Entry = { readonly id: number; readonly component: ToolCardComponent }
const byName = new Map<string, Entry[]>()
const byPredicate: { readonly id: number; readonly match: (toolName: string) => boolean; readonly component: ToolCardComponent }[] = []
let nextId = 0
const listeners = new Set<() => void>()
let version = 0

function changed() {
  version++
  for (const listener of listeners) listener()
}

/** Registers a card for exact tool names, or for every name a predicate accepts. Returns the unregister function. */
export function registerToolCard(match: ToolCardMatch, component: ToolCardComponent): () => void {
  const id = nextId++
  if (typeof match === 'function') {
    byPredicate.unshift({ id, match, component })
    changed()
    return () => {
      const at = byPredicate.findIndex(entry => entry.id === id)
      if (at >= 0) { byPredicate.splice(at, 1); changed() }
    }
  }
  for (const name of match) byName.set(name, [...(byName.get(name) ?? []), { id, component }])
  changed()
  return () => {
    for (const name of match) {
      const next = (byName.get(name) ?? []).filter(entry => entry.id !== id)
      if (next.length) byName.set(name, next); else byName.delete(name)
    }
    changed()
  }
}

/** The newest card registered for the name, else the newest predicate that accepts it. */
export function resolveToolCard(toolName: string): ToolCardComponent | null {
  const named = byName.get(toolName)
  if (named?.length) return named[named.length - 1]!.component
  return byPredicate.find(entry => entry.match(toolName))?.component ?? null
}

/** Re-render hook for hosts that show cards while plugins register: the snapshot changes on every (un)registration. */
export function subscribeToolCards(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function toolCardsVersion(): number { return version }
