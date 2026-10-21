// Saved window layouts, per project: the arrangement and which sessions and
// surfaces were in it, so a working set of windows comes back in one action.
//
// A small JSON file written whole through temp-and-rename, as the other
// `.agent-viewer-data` state is: a torn write would read as "no layouts".

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { validWindowSplitTree, type WindowSplitTree } from './windowSplitTree'
import type { FloatingRect } from './windowTabs'
import { surfaceWindowKey } from './windowOrder'

export type SavedWindowLayout = {
  id: string
  name: string
  savedAt: number
  arrangement: 'split' | 'main-stack' | 'grid'
  popoverTabs?: string[]
  activePopoverTab?: string | null
  floating?: { key: string; rect: FloatingRect; slot: number } | null
  primaryOpen?: boolean
  splitTree?: WindowSplitTree
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
  surfaceMeta?: Record<string, { cwd?: string; session?: string; path?: string }>
}

type StoreFile = { version: 1; projects: Record<string, SavedWindowLayout[]> }

const MAX_PER_PROJECT = 8

function storePath(): string {
  return path.join(process.cwd(), '.agent-viewer-data', 'window-layouts.json')
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const fraction = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
function validLayout(value: unknown): value is SavedWindowLayout {
  if (!object(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return false
  if (!['split', 'main-stack', 'grid'].includes(String(value.arrangement)) || !['columns', 'rows'].includes(String(value.orientation))) return false
  if (typeof value.readerLast !== 'boolean' || !fraction(value.readerShare) || !fraction(value.secondaryShare) || (value.bottomShare !== undefined && !fraction(value.bottomShare))) return false
  if (value.reader !== null && typeof value.reader !== 'string' || !strings(value.panes) || !strings(value.surfaces)) return false
  for (const field of ['order', 'popoverTabs']) if (value[field] !== undefined && !strings(value[field])) return false
  if (value.stacks !== undefined && (!Array.isArray(value.stacks) || !value.stacks.every(strings))) return false
  if (value.primaryOpen !== undefined && typeof value.primaryOpen !== 'boolean') return false
  if (value.activePopoverTab != null && typeof value.activePopoverTab !== 'string') return false
  if (value.splitTree !== undefined && !validWindowSplitTree(value.splitTree)) return false
  if (value.surfaceMeta !== undefined && !object(value.surfaceMeta)) return false
  if (value.floating != null) {
    const floating = value.floating
    if (!object(floating) || typeof floating.key !== 'string' || !Number.isInteger(floating.slot) || Number(floating.slot) < 0 || !object(floating.rect)) return false
    for (const field of ['x', 'y', 'width', 'height']) if (typeof floating.rect[field] !== 'number' || !Number.isFinite(floating.rect[field])) return false
    if (Number(floating.rect.width) <= 0 || Number(floating.rect.height) <= 0) return false
  }
  return true
}

/** Bad records cannot crash a menu; mutations preserve an unreadable file. */
function readStore(forWrite = false): StoreFile {
  const empty: StoreFile = { version: 1, projects: {} }
  try {
    const parsed: unknown = JSON.parse(readFileSync(storePath(), 'utf8'))
    if (!object(parsed) || parsed.version !== 1 || !object(parsed.projects)) throw new Error('Invalid saved layouts')
    for (const [project, entries] of Object.entries(parsed.projects)) {
      if (!Array.isArray(entries) || !entries.every(validLayout)) {
        if (forWrite) throw new Error('Invalid saved layout record')
      }
      empty.projects[project] = Array.isArray(entries) ? entries.filter(validLayout) : []
    }
    return empty
  } catch (error) {
    if (forWrite && existsSync(storePath())) throw new Error('Saved layouts could not be read; the existing file was preserved', { cause: error })
    return empty
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
  const store = readStore(true)
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
  const store = readStore(true)
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
  const store = readStore(true)
  store.projects[project] = (store.projects[project] ?? []).filter((entry) => entry.id !== id)
  writeStore(store)
}

/** One line for the menu: what the layout holds. */
export function describeSavedLayout(layout: SavedWindowLayout): string {
  const windows = new Set([
    ...(layout.primaryOpen !== false && layout.reader ? [layout.reader] : []),
    ...layout.panes, ...layout.surfaces.map(surfaceWindowKey), ...(layout.stacks ?? []).flat(),
    ...(layout.popoverTabs ?? []).map(surfaceWindowKey), ...(layout.floating ? [layout.floating.key] : []),
  ]).size
  const shape = layout.splitTree ? 'mixed splits' : layout.arrangement === 'grid' ? 'grid' : layout.arrangement === 'main-stack' ? 'stack' : layout.orientation === 'rows' ? 'stacked split' : 'split'
  return `${shape} · ${windows} window${windows === 1 ? '' : 's'}${layout.surfaces.length ? ` · ${layout.surfaces.join(', ')}` : ''}`
}
