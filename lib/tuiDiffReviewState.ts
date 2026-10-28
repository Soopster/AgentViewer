import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SelectedLineRange } from '@pierre/diffs'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const FILE = path.join(DATA_DIR, 'diff-review-v1.json')

export type TuiDiffReviewPreferences = {
  layoutMode: 'auto' | 'stack' | 'split'
  wrap: boolean
  tabWidth: 2 | 4 | 8
  horizontalOffset: number
  showLineNumbers: boolean
  showHunkHeaders: boolean
}

export type TuiDiffReviewNote = { filePath: string; range: SelectedLineRange; text: string }
export type TuiDiffReviewSnapshot = { preferences: TuiDiffReviewPreferences; notes: TuiDiffReviewNote[] }
type Store = Record<string, { version: 1; snapshot: TuiDiffReviewSnapshot }>

export const DEFAULT_TUI_DIFF_REVIEW_PREFERENCES: TuiDiffReviewPreferences = {
  layoutMode: 'auto', wrap: false, tabWidth: 4, horizontalOffset: 0, showLineNumbers: true, showHunkHeaders: true,
}

function validRange(value: unknown): value is SelectedLineRange {
  if (!value || typeof value !== 'object') return false
  const range = value as Partial<SelectedLineRange>
  return Number.isInteger(range.start) && Number.isInteger(range.end)
    && (range.side === 'additions' || range.side === 'deletions')
    && (range.endSide === 'additions' || range.endSide === 'deletions')
}

function normalizeSnapshot(value: unknown): TuiDiffReviewSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const raw = record.preferences && typeof record.preferences === 'object' ? record.preferences as Record<string, unknown> : {}
  const layoutMode = raw.layoutMode === 'stack' || raw.layoutMode === 'split' ? raw.layoutMode : 'auto'
  const tabWidth: 2 | 4 | 8 = raw.tabWidth === 2 || raw.tabWidth === 8 ? raw.tabWidth : 4
  const notes = Array.isArray(record.notes)
    ? record.notes.filter((note): note is TuiDiffReviewNote => {
      if (!note || typeof note !== 'object') return false
      const candidate = note as Partial<TuiDiffReviewNote>
      return typeof candidate.filePath === 'string' && typeof candidate.text === 'string' && validRange(candidate.range)
    }).slice(-500)
    : []
  return {
    preferences: {
      layoutMode, tabWidth, wrap: raw.wrap === true,
      horizontalOffset: typeof raw.horizontalOffset === 'number' && Number.isFinite(raw.horizontalOffset) ? Math.max(0, Math.round(raw.horizontalOffset)) : 0,
      showLineNumbers: raw.showLineNumbers !== false, showHunkHeaders: raw.showHunkHeaders !== false,
    },
    notes,
  }
}

function readStore(): Store {
  try {
    const value = JSON.parse(readFileSync(FILE, 'utf8')) as unknown
    return value && typeof value === 'object' ? value as Store : {}
  } catch { return {} }
}

export function tuiDiffReviewStorageKey(repoCwd: string, sourceKey: string): string {
  return JSON.stringify([path.resolve(repoCwd), sourceKey])
}

export function readTuiDiffReviewState(key: string): TuiDiffReviewSnapshot {
  return normalizeSnapshot(readStore()[key]?.snapshot) ?? { preferences: { ...DEFAULT_TUI_DIFF_REVIEW_PREFERENCES }, notes: [] }
}

export function writeTuiDiffReviewState(key: string, snapshot: TuiDiffReviewSnapshot): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    const store = readStore()
    store[key] = { version: 1, snapshot }
    const temporaryFile = `${FILE}.${process.pid}.tmp`
    writeFileSync(temporaryFile, JSON.stringify(store), 'utf8')
    renameSync(temporaryFile, FILE)
  } catch {
    // Review state is a convenience; an unavailable or read-only data directory
    // must never interfere with opening the diff viewer.
  }
}
