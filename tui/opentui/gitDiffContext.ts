import { execFile } from 'node:child_process'
import type { FileDiffMetadata } from '@pierre/diffs'
import type { TuiPierreDiffRow, TuiPierreDiffView, TuiPierreSplitRow } from './pierreDiffView'

export type DiffContextGap = {
  id: string
  filePath: string
  baseOid: string
  oldStart: number
  newStart: number
  count?: number
  direction: 'before' | 'after'
}
export type DiffContextExpansion = {
  count: number
  total?: number
  lines: string[]
  loading?: boolean
  error?: boolean
}
export const CONTEXT_STEP = 20

/** Bind omitted lines to the old blob named by the displayed patch, never the live worktree. */
export function diffContextGap(file: FileDiffMetadata, filePath: string, hunkIndex: number, direction: 'before' | 'after'): DiffContextGap | undefined {
  const baseOid = file.prevObjectId
  if (!baseOid || !/^[a-f0-9]{4,64}$/i.test(baseOid) || /^0+$/.test(baseOid) || file.prevMode === '160000' || file.mode === '160000') return
  const hunk = file.hunks[hunkIndex]
  if (!hunk || (direction === 'before' && hunk.collapsedBefore <= 0)) return
  const count = direction === 'before' ? hunk.collapsedBefore : undefined
  const oldStart = direction === 'before' ? hunk.deletionStart - count! : hunk.deletionStart + hunk.deletionCount + (hunk.deletionCount === 0 ? 1 : 0)
  const newStart = direction === 'before' ? hunk.additionStart - count! : hunk.additionStart + hunk.additionCount + (hunk.additionCount === 0 ? 1 : 0)
  if (oldStart < 1 || newStart < 1) return
  return { id: `${filePath}\0${baseOid}\0${direction}:${oldStart}:${newStart}`, filePath, baseOid, oldStart, newStart, count, direction }
}

/** Preserve blank lines and trailing whitespace when reading immutable Git content. */
export function readDiffBaseLines(cwd: string, oid: string, signal?: AbortSignal): Promise<string[]> {
  if (!/^[a-f0-9]{4,64}$/i.test(oid) || /^0+$/.test(oid)) return Promise.reject(new Error('Invalid base blob'))
  return new Promise((resolve, reject) => {
    execFile('git', ['cat-file', 'blob', oid], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, signal }, (error, stdout) => {
      if (error) { reject(error); return }
      const lines = stdout.split('\n')
      if (lines.at(-1) === '') lines.pop()
      resolve(lines.map(line => line.replace(/\r$/, '')))
    })
  })
}

/** Resolve precisely the unchanged range shared by both sides of a gap. */
export function expandDiffContext(gap: DiffContextGap, source: string[], previousCount: number): DiffContextExpansion {
  const available = Math.max(0, source.length - gap.oldStart + 1)
  const total = gap.count === undefined ? available : Math.min(gap.count, available)
  const count = Math.min(total, previousCount + CONTEXT_STEP)
  const offset = gap.direction === 'before' ? total - count : 0
  return { count, total, lines: source.slice(gap.oldStart - 1 + offset, gap.oldStart - 1 + offset + count) }
}

function gapLabel(gap: DiffContextGap, expansion?: DiffContextExpansion): string {
  if (expansion?.loading) return 'Loading context…'
  if (expansion?.error) return 'Context unavailable — e / click to retry'
  const total = expansion?.total ?? gap.count
  const count = expansion?.count ?? 0
  if (total === 0) return 'No following context'
  if (total !== undefined && count >= total) return `[-] Collapse ${count} context lines (c / click)`
  const remaining = total === undefined ? undefined : total - count
  return `[+] Show ${Math.min(CONTEXT_STEP, remaining ?? CONTEXT_STEP)} ${gap.direction === 'before' ? 'preceding' : 'following'} lines${remaining === undefined ? '' : ` (${remaining} hidden)`} · e${count ? ' / c collapse' : ''}`
}

/** Insert expanded context into both layouts with identical source-line identities. */
export function applyDiffContext(view: TuiPierreDiffView, expansions: ReadonlyMap<string, DiffContextExpansion>): TuiPierreDiffView {
  function expandRows<T extends TuiPierreDiffRow | TuiPierreSplitRow>(rows: T[], split: boolean): T[] {
    const result: T[] = []
    for (const row of rows) {
      const gap = row.contextGap
      if (!gap) { result.push(row); continue }
      const expansion = expansions.get(gap.id)
      result.push({ ...row, text: gapLabel(gap, expansion) })
      if (!expansion?.count) continue
      const offset = gap.direction === 'before' ? (expansion.total ?? gap.count ?? 0) - expansion.count : 0
      expansion.lines.forEach((text, index) => {
        const oldLine = gap.oldStart + offset + index
        const newLine = gap.newStart + offset + index
        const common = { key: `${gap.id}:context:${oldLine}`, filePath: gap.filePath, expandedGapId: gap.id }
        result.push((split
          ? { ...common, tone: 'split-context', left: { kind: 'context', text, lineNum: oldLine }, right: { kind: 'context', text, lineNum: newLine } }
          : { ...common, tone: 'context', text, oldLine, newLine, indicator: ' ' }) as T)
      })
    }
    return result
  }
  return { ...view, rows: expandRows(view.rows, false), splitRows: expandRows(view.splitRows, true) }
}

/** Keyboard actions target the selected gap, expanded line owner, or nearest gap in this file. */
export function nearestDiffContextGap(rows: Array<TuiPierreDiffRow | TuiPierreSplitRow>, cursor: number, expansions: ReadonlyMap<string, DiffContextExpansion>, collapse: boolean): DiffContextGap | undefined {
  const current = rows[cursor]
  if (!current) return
  let best: DiffContextGap | undefined
  let distance = Infinity
  rows.forEach((row, index) => {
    const gap = row.contextGap
    if (!gap || gap.filePath !== current.filePath || (collapse && !expansions.get(gap.id)?.count)) return
    const nextDistance = current.expandedGapId === gap.id ? -1 : Math.abs(index - cursor)
    if (nextDistance < distance) { best = gap; distance = nextDistance }
  })
  return best
}
