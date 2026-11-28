// The pinned tabs: a small store the strip, the menus and the manager read, kept in tui.json.
// Loaded on first use (a preference is not a boot cost); a choice made before the load lands wins.
import { useSyncExternalStore } from 'react'
import { getConfiguredTuiPinnedTabs, setConfiguredTuiPinnedTabs, getConfiguredTuiPinnedTabsRow, setConfiguredTuiPinnedTabsRow } from '../../lib/tuiState'
import { togglePinnedKey } from './tabOrder'

let pinned: ReadonlySet<string> = new Set()
let pinnedRow = false
let loaded: Promise<void> | null = null
let chosen = false
let rowChosen = false
const listeners = new Set<() => void>()

function commit(next: readonly string[]): void {
  pinned = new Set(next)
  for (const listener of listeners) listener()
}

function load(): void {
  loaded ??= Promise.all([getConfiguredTuiPinnedTabs(), getConfiguredTuiPinnedTabsRow()])
    .then(([keys, row]) => {
      if (!rowChosen) pinnedRow = row
      if (!chosen) commit(keys)
      else for (const listener of listeners) listener()
    })
    .catch(() => {})
}

export function subscribePinnedTabs(listener: () => void): () => void {
  load()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function readPinnedTabs(): ReadonlySet<string> {
  return pinned
}

export function usePinnedTabs(): ReadonlySet<string> {
  return useSyncExternalStore(subscribePinnedTabs, readPinnedTabs, readPinnedTabs)
}

/** Pin or unpin; returns whether the tab is now pinned. */
export function togglePinnedTab(key: string): boolean {
  chosen = true
  const next = togglePinnedKey([...pinned], key)
  commit(next)
  void setConfiguredTuiPinnedTabs(next).catch(() => {})
  return next.includes(key)
}

/** Whether pinned tabs are drawn on a dedicated row above the strip. */
export function readPinnedTabsRow(): boolean {
  return pinnedRow
}

export function usePinnedTabsRow(): boolean {
  return useSyncExternalStore(subscribePinnedTabs, readPinnedTabsRow, readPinnedTabsRow)
}

export function togglePinnedTabsRow(): boolean {
  rowChosen = true
  pinnedRow = !pinnedRow
  for (const listener of listeners) listener()
  void setConfiguredTuiPinnedTabsRow(pinnedRow).catch(() => {})
  return pinnedRow
}
