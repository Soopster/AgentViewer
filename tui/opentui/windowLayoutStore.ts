// Saved window layouts, per project: the arrangement and which sessions and
// surfaces were in it, so a working set of windows comes back in one action.
//
// A small JSON file written whole through temp-and-rename, as the other
// `.agent-viewer-data` state is: a torn write would read as "no layouts".

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type SavedWindowLayout = {
  id: string
  name: string
  savedAt: number
  arrangement: 'split' | 'main-stack' | 'grid'
  orientation: 'columns' | 'rows'
  readerLast: boolean
  readerShare: number
  secondaryShare: number
  /** Absent in layouts saved before the bottom row had its own divider. */
  bottomShare?: number
  /** Session keys: the reader's, then the panes' in order. */
  reader: string | null
  panes: string[]
  surfaces: Array<'terminal' | 'diff' | 'files'>
}

type StoreFile = { version: 1; projects: Record<string, SavedWindowLayout[]> }

const MAX_PER_PROJECT = 8

function storePath(): string {
  return path.join(process.cwd(), '.agent-viewer-data', 'window-layouts.json')
}

function readStore(): StoreFile {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), 'utf8')) as StoreFile
    return parsed && parsed.version === 1 && parsed.projects && typeof parsed.projects === 'object' ? parsed : { version: 1, projects: {} }
  } catch {
    return { version: 1, projects: {} }
  }
}

function writeStore(store: StoreFile): void {
  const file = storePath()
  mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`)
  renameSync(temp, file)
}

export function listSavedWindowLayouts(project: string): SavedWindowLayout[] {
  return [...(readStore().projects[project] ?? [])].sort((a, b) => b.savedAt - a.savedAt)
}

/** Saves `layout` under the next free "Layout N" name; the oldest beyond the cap is dropped. */
export function saveWindowLayout(project: string, layout: Omit<SavedWindowLayout, 'id' | 'name' | 'savedAt'>): SavedWindowLayout {
  const store = readStore()
  const existing = store.projects[project] ?? []
  const taken = new Set(existing.map((entry) => entry.name))
  let number = existing.length + 1
  while (taken.has(`Layout ${number}`)) number += 1
  const saved: SavedWindowLayout = { ...layout, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: `Layout ${number}`, savedAt: Date.now() }
  store.projects[project] = [...existing, saved].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_PER_PROJECT)
  writeStore(store)
  return saved
}

export function deleteWindowLayout(project: string, id: string): void {
  const store = readStore()
  store.projects[project] = (store.projects[project] ?? []).filter((entry) => entry.id !== id)
  writeStore(store)
}

/** One line for the menu: what the layout holds. */
export function describeSavedLayout(layout: SavedWindowLayout): string {
  const windows = 1 + layout.panes.length + layout.surfaces.length
  const shape = layout.arrangement === 'grid' ? 'grid' : layout.arrangement === 'main-stack' ? 'stack' : layout.orientation === 'rows' ? 'stacked split' : 'split'
  return `${shape} · ${windows} window${windows === 1 ? '' : 's'}${layout.surfaces.length ? ` · ${layout.surfaces.join(', ')}` : ''}`
}
