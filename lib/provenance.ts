// Code provenance — "git blame for agents". Attributes the lines of a file on
// disk back to the (session, turn) whose recorded edit wrote them, using the
// file_edits table that sessionPersistence.ts populates from every provider's
// Edit/Write/patch tool calls (extraction lives in provenanceExtract.ts).
//
// Attribution is content-anchored, not diff-replayed: each recorded edit's
// added lines are matched against the current file via unique-line anchors
// extended into runs (with a whole-block fallback for small edits), applied
// oldest → newest so the most recent writer of a line wins — the same "who
// owns this line now" semantics as git blame. Unmatched lines were written by
// humans, pre-index sessions, or have since been rewritten.
//
// Node APIs only (fs + git subprocess); consumed by the /api/provenance and
// /api/sessions/[id]/provenance routes. Never import from client components.

import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import {
  readFileEditsForFile,
  readFileEditsForSession,
  readPersistedSessionRecord,
  type PersistedFileEditRecord,
} from './sessionPersistence'
import type { AgentProvider } from './types'
import { findRepoRoot } from './worktreeTasks'

// Bounds: blame is an interactive query; a file bigger than this is generated
// output nobody reads line-by-line. Truncation is reported, never silent.
const MAX_BLAME_LINES = 20_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_SESSION_FILES = 60
// Anchor lines must carry some signal; `}` and blank lines anchor nothing.
const MIN_ANCHOR_CHARS = 4
// Whole-block fallback only for edits small enough to expect verbatim survival.
const MAX_WHOLE_BLOCK_LINES = 400

export type ProvenanceEditInfo = {
  id: number
  provider: AgentProvider
  sessionId: string
  sessionKey: string
  sessionTitle: string | null
  sessionCwd: string | null
  messageUuid: string
  timestampMs: number | null
  tool: string
  kind: string
  prompt: string | null
  model: string | null
}

export type ProvenanceSegment = {
  /** 0-based inclusive line range of the current file. */
  start: number
  end: number
  edit: ProvenanceEditInfo
}

export type CommitSegment = {
  start: number
  end: number
  sha: string
  author: string
  summary: string
  authorTime: number | null
}

export type ProvenanceBlameResult = {
  file: string
  relPath: string | null
  repoRoot: string | null
  totalLines: number
  truncated: boolean
  lines: string[]
  segments: ProvenanceSegment[]
  commitSegments: CommitSegment[]
  editsConsidered: number
  attributedLines: number
}

export type SessionFileProvenance = {
  filePath: string
  resolvedPath: string | null
  exists: boolean
  edits: number
  linesRecorded: number
  /** Lines of the current file still attributed to this session (null = file unreadable). */
  linesSurviving: number | null
  totalFileLines: number | null
  lastEditAt: number | null
  tools: string[]
  kinds: string[]
}

export type SessionProvenanceResult = {
  provider: AgentProvider
  sessionId: string
  cwd: string | null
  files: SessionFileProvenance[]
  filesTruncated: boolean
}

// ---------------------------------------------------------------------------
// Line matching

/** Longest increasing subsequence (by value) — returns indices into `values`. */
function longestIncreasingRun(values: number[]): number[] {
  const tails: number[] = []
  const tailIndices: number[] = []
  const prev = new Array<number>(values.length).fill(-1)
  for (let i = 0; i < values.length; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tails[mid] < values[i]) lo = mid + 1
      else hi = mid
    }
    tails[lo] = values[i]
    tailIndices[lo] = i
    prev[i] = lo > 0 ? tailIndices[lo - 1] : -1
  }
  const result: number[] = []
  let cursor = tailIndices.length > 0 ? tailIndices[tailIndices.length - 1] : -1
  while (cursor >= 0) {
    result.push(cursor)
    cursor = prev[cursor]
  }
  return result.reverse()
}

function countOccurrences(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)
  return counts
}

/**
 * File line indices (0-based) that this edit's added lines still occupy.
 * Unique-content anchors extended into contiguous runs; small edits fall back
 * to a verbatim whole-block scan when no line is unique enough to anchor.
 */
export function matchEditToFile(editLines: string[], fileLines: string[]): number[] {
  if (editLines.length === 0 || fileLines.length === 0) return []

  const editCounts = countOccurrences(editLines)
  const fileCounts = countOccurrences(fileLines)
  const fileIndexByContent = new Map<string, number>()
  for (let i = 0; i < fileLines.length; i++) {
    if (!fileIndexByContent.has(fileLines[i])) fileIndexByContent.set(fileLines[i], i)
  }

  const anchorEditIdx: number[] = []
  const anchorFileIdx: number[] = []
  for (let e = 0; e < editLines.length; e++) {
    const content = editLines[e]
    if (content.trim().length < MIN_ANCHOR_CHARS) continue
    if (editCounts.get(content) !== 1 || fileCounts.get(content) !== 1) continue
    anchorEditIdx.push(e)
    anchorFileIdx.push(fileIndexByContent.get(content)!)
  }

  const matched = new Set<number>()

  if (anchorEditIdx.length > 0) {
    // Keep only anchors whose file order agrees with their edit order, then
    // extend each anchor pair in both directions while lines keep matching.
    for (const idx of longestIncreasingRun(anchorFileIdx)) {
      const e0 = anchorEditIdx[idx]
      const f0 = anchorFileIdx[idx]
      matched.add(f0)
      for (let k = 1; e0 - k >= 0 && f0 - k >= 0 && editLines[e0 - k] === fileLines[f0 - k]; k++) {
        matched.add(f0 - k)
      }
      for (let k = 1; e0 + k < editLines.length && f0 + k < fileLines.length && editLines[e0 + k] === fileLines[f0 + k]; k++) {
        matched.add(f0 + k)
      }
    }
    return [...matched].sort((a, b) => a - b)
  }

  if (editLines.length <= MAX_WHOLE_BLOCK_LINES) {
    for (let f = 0; f + editLines.length <= fileLines.length; f++) {
      let hit = true
      for (let k = 0; k < editLines.length; k++) {
        if (fileLines[f + k] !== editLines[k]) {
          hit = false
          break
        }
      }
      if (hit) {
        for (let k = 0; k < editLines.length; k++) matched.add(f + k)
        break
      }
    }
  }
  return [...matched].sort((a, b) => a - b)
}

function editInfo(record: PersistedFileEditRecord): ProvenanceEditInfo {
  return {
    id: record.id,
    provider: record.provider,
    sessionId: record.sessionId,
    sessionKey: record.sessionKey,
    sessionTitle: record.sessionTitle,
    sessionCwd: record.sessionCwd,
    messageUuid: record.messageUuid,
    timestampMs: record.timestampMs,
    tool: record.tool,
    kind: record.kind,
    prompt: record.prompt,
    model: record.model,
  }
}

/**
 * Assign each file line its owning edit (records must be oldest-first; later
 * edits overwrite earlier claims). Returns per-line owner indices into
 * `records`, -1 = unattributed.
 */
export function attributeFileLines(fileLines: string[], records: PersistedFileEditRecord[]): number[] {
  const owners = new Array<number>(fileLines.length).fill(-1)
  for (let r = 0; r < records.length; r++) {
    if (records[r].addedLines.length === 0) continue
    for (const lineIdx of matchEditToFile(records[r].addedLines, fileLines)) {
      owners[lineIdx] = r
    }
  }
  return owners
}

function ownersToSegments(owners: number[], records: PersistedFileEditRecord[]): ProvenanceSegment[] {
  const segments: ProvenanceSegment[] = []
  let start = -1
  let current = -1
  const flush = (end: number) => {
    if (current >= 0 && start >= 0) segments.push({ start, end, edit: editInfo(records[current]) })
    start = -1
    current = -1
  }
  for (let i = 0; i < owners.length; i++) {
    if (owners[i] === current) continue
    flush(i - 1)
    if (owners[i] >= 0) {
      start = i
      current = owners[i]
    }
  }
  flush(owners.length - 1)
  return segments
}

// ---------------------------------------------------------------------------
// Git blame join

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`git ${args[0]} failed${stderr ? `: ${String(stderr).trim()}` : ''}`))
          return
        }
        resolve(String(stdout ?? ''))
      },
    )
  })
}

const UNCOMMITTED_SHA = '0'.repeat(40)

type BlameLine = { sha: string; author: string; summary: string; authorTime: number | null }

/** Working-tree `git blame --line-porcelain`; null entries = uncommitted lines. */
async function gitBlameLines(repoRoot: string, relPath: string): Promise<(BlameLine | null)[] | null> {
  let out: string
  try {
    out = await git(repoRoot, ['blame', '--line-porcelain', '--', relPath])
  } catch {
    return null
  }
  const commits = new Map<string, BlameLine>()
  const lines: (BlameLine | null)[] = []
  let currentSha: string | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('\t')) {
      // Content line terminates one blame entry.
      lines.push(currentSha && currentSha !== UNCOMMITTED_SHA ? commits.get(currentSha) ?? null : null)
      currentSha = null
      continue
    }
    const headerSha = /^([0-9a-f]{40}) \d+ \d+/.exec(line)
    if (headerSha) {
      currentSha = headerSha[1]
      if (!commits.has(currentSha)) {
        commits.set(currentSha, { sha: currentSha, author: '', summary: '', authorTime: null })
      }
      continue
    }
    if (!currentSha) continue
    const entry = commits.get(currentSha)!
    if (line.startsWith('author ')) entry.author = line.slice('author '.length)
    else if (line.startsWith('summary ')) entry.summary = line.slice('summary '.length)
    else if (line.startsWith('author-time ')) {
      const seconds = Number(line.slice('author-time '.length))
      entry.authorTime = Number.isFinite(seconds) ? seconds * 1000 : null
    }
  }
  return lines
}

function blameToSegments(blame: (BlameLine | null)[], lineCount: number): CommitSegment[] {
  const segments: CommitSegment[] = []
  let start = -1
  let current: BlameLine | null = null
  const flush = (end: number) => {
    if (current && start >= 0) {
      segments.push({
        start,
        end,
        sha: current.sha,
        author: current.author,
        summary: current.summary,
        authorTime: current.authorTime,
      })
    }
    start = -1
    current = null
  }
  const bounded = Math.min(blame.length, lineCount)
  for (let i = 0; i < bounded; i++) {
    const entry = blame[i]
    if (entry && current && entry.sha === current.sha) continue
    flush(i - 1)
    if (entry) {
      start = i
      current = entry
    }
  }
  flush(bounded - 1)
  return segments
}

// ---------------------------------------------------------------------------
// Queries

async function readFileLines(absPath: string): Promise<{ lines: string[]; truncated: boolean } | null> {
  try {
    const stat = await fs.stat(absPath)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null
    const text = await fs.readFile(absPath, 'utf-8')
    const lines = text.split('\n')
    // A trailing newline yields one phantom empty line; drop it so counts
    // match what editors and git blame report.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    if (lines.length > MAX_BLAME_LINES) return { lines: lines.slice(0, MAX_BLAME_LINES), truncated: true }
    return { lines, truncated: false }
  } catch {
    return null
  }
}

/**
 * Code-side query: who wrote the lines of this file? `file` may be absolute
 * or relative to `cwd`. Attribution segments come from the provenance index;
 * commit segments from working-tree git blame (null-safe when not a repo).
 */
export async function blameFileProvenance(opts: { file: string; cwd?: string | null }): Promise<ProvenanceBlameResult> {
  const baseDir = opts.cwd && path.isAbsolute(opts.cwd) ? opts.cwd : process.cwd()
  const absPath = path.isAbsolute(opts.file) ? opts.file : path.resolve(baseDir, opts.file)

  const repoRoot = await findRepoRoot(path.dirname(absPath)).catch(() => null)
  const relPath = repoRoot ? path.relative(repoRoot, absPath) : null
  const safeRelPath = relPath && !relPath.startsWith('..') ? relPath : null

  const read = await readFileLines(absPath)
  if (!read) {
    throw new Error(`Cannot read ${absPath} (missing, not a file, or larger than ${MAX_FILE_BYTES} bytes)`)
  }

  const records = await readFileEditsForFile(absPath, safeRelPath)
  const owners = attributeFileLines(read.lines, records)
  const segments = ownersToSegments(owners, records)
  const attributedLines = owners.reduce((count, owner) => (owner >= 0 ? count + 1 : count), 0)

  let commitSegments: CommitSegment[] = []
  if (repoRoot && safeRelPath) {
    const blame = await gitBlameLines(repoRoot, safeRelPath)
    if (blame) commitSegments = blameToSegments(blame, read.lines.length)
  }

  return {
    file: absPath,
    relPath: safeRelPath,
    repoRoot,
    totalLines: read.lines.length,
    truncated: read.truncated,
    lines: read.lines,
    segments,
    commitSegments,
    editsConsidered: records.length,
    attributedLines,
  }
}

async function resolveEditedFile(filePath: string, cwd: string | null): Promise<string | null> {
  const candidates = path.isAbsolute(filePath)
    ? [filePath]
    : cwd
      ? [path.resolve(cwd, filePath)]
      : []
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // keep looking
    }
  }
  return candidates[0] ?? null
}

/**
 * Session-side query: what code in the repo today traces back to this session?
 * Groups the session's recorded edits by file and re-attributes each file
 * against ALL sessions' edits, so lines later rewritten by another session are
 * not counted as surviving.
 */
export async function sessionProvenanceSummary(
  provider: AgentProvider,
  sessionId: string,
): Promise<SessionProvenanceResult> {
  const [records, sessionRecord] = await Promise.all([
    readFileEditsForSession(provider, sessionId),
    readPersistedSessionRecord(provider, sessionId),
  ])
  const cwd = sessionRecord?.cwd ?? records[0]?.sessionCwd ?? null
  const sessionKey = records[0]?.sessionKey ?? `${provider}:${sessionId}`

  const byFile = new Map<string, PersistedFileEditRecord[]>()
  for (const record of records) {
    const group = byFile.get(record.filePath)
    if (group) group.push(record)
    else byFile.set(record.filePath, [record])
  }

  const entries = [...byFile.entries()]
  const filesTruncated = entries.length > MAX_SESSION_FILES
  const files: SessionFileProvenance[] = []

  for (const [filePath, edits] of entries.slice(0, MAX_SESSION_FILES)) {
    const linesRecorded = edits.reduce((sum, edit) => sum + edit.addedLines.length, 0)
    const lastEditAt = edits.reduce<number | null>(
      (latest, edit) => (edit.timestampMs !== null && (latest === null || edit.timestampMs > latest) ? edit.timestampMs : latest),
      null,
    )
    const tools = [...new Set(edits.map((edit) => edit.tool))].sort((a, b) => a.localeCompare(b))
    const kinds = [...new Set(edits.map((edit) => edit.kind))].sort((a, b) => a.localeCompare(b))

    const resolvedPath = await resolveEditedFile(filePath, cwd)
    let exists = false
    let linesSurviving: number | null = null
    let totalFileLines: number | null = null

    if (resolvedPath) {
      const read = await readFileLines(resolvedPath)
      if (read) {
        exists = true
        totalFileLines = read.lines.length
        const repoRoot = await findRepoRoot(path.dirname(resolvedPath)).catch(() => null)
        const relPath = repoRoot ? path.relative(repoRoot, resolvedPath) : null
        const allEdits = await readFileEditsForFile(resolvedPath, relPath && !relPath.startsWith('..') ? relPath : null)
        const owners = attributeFileLines(read.lines, allEdits)
        linesSurviving = owners.reduce(
          (count, owner) => (owner >= 0 && allEdits[owner].sessionKey === sessionKey ? count + 1 : count),
          0,
        )
      }
    }

    files.push({
      filePath,
      resolvedPath,
      exists,
      edits: edits.length,
      linesRecorded,
      linesSurviving,
      totalFileLines,
      lastEditAt,
      tools,
      kinds,
    })
  }

  files.sort((a, b) => (b.linesSurviving ?? -1) - (a.linesSurviving ?? -1) || (b.lastEditAt ?? 0) - (a.lastEditAt ?? 0))
  return { provider, sessionId, cwd, files, filesTruncated }
}
