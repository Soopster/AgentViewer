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
  /** Relative sizes inside each group of panes; absent in layouts saved before every border dragged. */
  weights?: Partial<Record<'split' | 'stack' | 'gridTop' | 'gridBottom', number[]>>
  /** Session keys: the reader's, then the panes' in order. */
  coordinatorRunId?: string
  reader: string | null
  panes: string[]
  /** Surface window ids (`kind` or `kind#n`). */
  surfaces: string[]
  /** Every window's key in display order; absent before surfaces could sit among session panes. */
  order?: string[]
  /** Windows sharing a frame as tabs, by window key; absent before tabs. */
  stacks?: string[][]
  /** What each popover window is pinned to, by window id; absent before popover windows. */
  surfaceMeta?: Record<string, { session?: string; path?: string }>
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
export type WindowLayoutContents = Omit<SavedWindowLayout, 'id' | 'name' | 'savedAt'>

export function saveWindowLayout(project: string, layout: WindowLayoutContents, name?: string): SavedWindowLayout {
  const store = readStore()
  const existing = store.projects[project] ?? []
  const taken = new Set(existing.map((entry) => entry.name))
  let number = existing.length + 1
  while (taken.has(`Layout ${number}`)) number += 1
  const saved: SavedWindowLayout = { ...layout, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name === undefined ? `Layout ${number}` : layoutName(name), savedAt: Date.now() }
  store.projects[project] = [...existing, saved].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_PER_PROJECT)
  writeStore(store)
  return saved
}

function layoutName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!clean) throw new Error('Give the layout a name')
  if (clean.length > 60) throw new Error('Layout names can have up to 60 characters')
  return clean
}

/** Preserve identity and name when updating a workspace's windows. */
export function updateWindowLayout(project: string, id: string, change: { name?: string; layout?: WindowLayoutContents }): SavedWindowLayout {
  const store = readStore()
  const existing = store.projects[project] ?? []
  const index = existing.findIndex((entry) => entry.id === id)
  if (index < 0) throw new Error('That saved layout no longer exists')
  const previous = existing[index]!
  const saved = {
    ...previous, ...change.layout,
    id: previous.id,
    name: change.name === undefined ? previous.name : layoutName(change.name),
    savedAt: Date.now(),
  }
  existing[index] = saved
  store.projects[project] = existing
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
