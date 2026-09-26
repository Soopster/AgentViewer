// Frecency for file pickers: a path you open often and opened recently outranks
// one you opened once a month ago. Ported from opencode's TUI
// (`packages/tui/src/prompt/frecency.tsx`), which scores an entry as
// `frequency / (1 + ageInDays)` — frequency alone would pin a file you have
// finished with, recency alone forgets the file you return to every day.
//
// The store is JSONL and append-only on use, compacted on load. A use costs one
// `appendFileSync` of a single line, so a crash loses at most that line rather
// than the whole table, and the rewrite happens once per process instead of once
// per keystroke.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

import path from 'node:path'

const DATA_DIR = path.join(process.cwd(), '.agent-viewer-data')
const FILE = path.join(DATA_DIR, 'frecency.jsonl')

/** Beyond this the table is trimmed to the most recently used entries on load. */
export const FRECENCY_MAX_ENTRIES = 1000

const DAY_MS = 86_400_000

type FrecencyEntry = { path: string; frequency: number; lastUsed: number }

let cache: Map<string, FrecencyEntry> | null = null

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

/**
 * Parses a JSONL table, keeping the last line written for each path — an append
 * is an update, so later lines supersede earlier ones. A malformed line is
 * skipped rather than discarding the file: a torn final write must not cost the
 * whole history.
 */
export function parseFrecencyTable(text: string): FrecencyEntry[] {
  const latest = new Map<string, FrecencyEntry>()
  for (const line of text.split('\n')) {
    if (!line) continue
    try {
      const parsed = JSON.parse(line) as Partial<FrecencyEntry>
      if (typeof parsed.path !== 'string' || !parsed.path) continue
      if (typeof parsed.frequency !== 'number' || !Number.isFinite(parsed.frequency)) continue
      if (typeof parsed.lastUsed !== 'number' || !Number.isFinite(parsed.lastUsed)) continue
      latest.set(parsed.path, { path: parsed.path, frequency: parsed.frequency, lastUsed: parsed.lastUsed })
    } catch {
      continue
    }
  }
  return [...latest.values()]
    .sort((left, right) => right.lastUsed - left.lastUsed)
    .slice(0, FRECENCY_MAX_ENTRIES)
}

/** `0` for an entry that has never been used, so an unknown path always sorts last. */
export function frecencyScore(entry: FrecencyEntry | undefined, now = Date.now()): number {
  if (!entry) return 0
  return entry.frequency / (1 + Math.max(0, now - entry.lastUsed) / DAY_MS)
}

function load(): Map<string, FrecencyEntry> {
  if (cache) return cache
  let entries: FrecencyEntry[] = []
  try {
    if (existsSync(FILE)) entries = parseFrecencyTable(readFileSync(FILE, 'utf-8'))
  } catch {
    entries = []
  }
  cache = new Map(entries.map((entry) => [entry.path, entry]))
  // Compact once per process: every append since the last compaction is a
  // superseded line, and the file would otherwise grow without bound.
  if (entries.length > 0) rewrite(entries)
  return cache
}

function rewrite(entries: FrecencyEntry[]): void {
  try {
    ensureDir()
    const temporaryFile = `${FILE}.${process.pid}.tmp`
    writeFileSync(temporaryFile, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf-8')
    renameSync(temporaryFile, FILE)
  } catch {
    // best-effort; ranking is a convenience and the in-memory table still works
  }
}

/**
 * The stable key for a file: its root joined to its repo-relative path, with
 * separators normalized. Callers rank relative paths but record absolute ones,
 * and on Windows `path.resolve` and a string join disagree about separators —
 * which would not fail, it would silently score every file 0.
 */
export function frecencyKey(root: string, relativePath: string): string {
  return `${frecencyPrefix(root)}/${normalizeSeparators(relativePath)}`
}

/**
 * The root half of a key, for a caller that joins the relative half itself —
 * the mention worker, which ranks relative paths against this table.
 */
export function frecencyPrefix(root: string): string {
  return normalizeSeparators(root).replace(/\/+$/, '')
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, '/')
}

/** Records one use of a path, keyed as `frecencyKey` produces. Safe on every open. */
export function recordFrecencyUse(absolutePath: string, now = Date.now()): void {
  if (!absolutePath) return
  const table = load()
  const previous = table.get(absolutePath)
  const entry: FrecencyEntry = {
    path: absolutePath,
    frequency: (previous?.frequency ?? 0) + 1,
    lastUsed: now,
  }
  table.set(absolutePath, entry)
  try {
    ensureDir()
    appendFileSync(FILE, JSON.stringify(entry) + '\n', 'utf-8')
  } catch {
    // best-effort
  }
  if (table.size <= FRECENCY_MAX_ENTRIES) return
  const trimmed = [...table.values()]
    .sort((left, right) => right.lastUsed - left.lastUsed)
    .slice(0, FRECENCY_MAX_ENTRIES)
  cache = new Map(trimmed.map((item) => [item.path, item]))
  rewrite(trimmed)
}

/**
 * Scores for every known path, highest first in insertion order. Callers rank
 * with this *after* matching, so a file that has never been opened is still
 * found by name — frecency breaks ties, it does not outrank a match.
 */
export function readFrecencyScores(now = Date.now()): Map<string, number> {
  const table = load()
  const scored = [...table.values()]
    .map((entry) => [entry.path, frecencyScore(entry, now)] as const)
    .sort((left, right) => right[1] - left[1])
  return new Map(scored)
}

/** Test seam: drops the in-process table so the next read re-parses the file. */
export function resetFrecencyCacheForTests(): void {
  cache = null
}
