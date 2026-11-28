/** Browser-safe Second Opinion contract. Reviews run and persist behind renderer adapters (lib/secondOpinion/service.ts). */
import type { SecondOpinionReview, SecondOpinionReviewer, SecondOpinionSeverity } from '../secondOpinion/review'

export type { SecondOpinionExcerpt, SecondOpinionFinding, SecondOpinionReview, SecondOpinionReviewer, SecondOpinionSeverity } from '../secondOpinion/review'
export { SECOND_OPINION_REVIEWERS, defaultReviewerFor, secondOpinionCounts, secondOpinionFollowUp } from '../secondOpinion/review'

export type SecondOpinionStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'

export type SecondOpinionRecord = {
  id: string
  /** The turn's starting snapshot, and the next turn's (null: the newest turn, bounded by the working tree). */
  checkpointSha: string
  untilSha: string | null
  /** A signature of the diff the review read; for the newest turn, what tells it stale once that diff moves. */
  endTree: string
  turnLabel: string
  sessionId?: string
  authorProvider?: string
  reviewer: SecondOpinionReviewer
  model: string
  /** Set when the chosen reviewer was not installed and the other one read the turn instead. */
  fellBackFrom?: SecondOpinionReviewer
  auto: boolean
  status: SecondOpinionStatus
  startedAt: number
  finishedAt?: number
  error?: string
  review?: SecondOpinionReview
  dismissed: string[]
  /** Computed on read: the code under review has moved since it was read. */
  stale?: boolean
}

export type SecondOpinionReviewerChoice = 'auto' | SecondOpinionReviewer
export type SecondOpinionSettings = {
  /** Review each turn in this repository once it settles. Off by default: it spends model usage. */
  autoReview: boolean
  reviewer: SecondOpinionReviewerChoice
  models: Record<SecondOpinionReviewer, string>
}

export type SecondOpinionSnapshot = { cwd: string; settings: SecondOpinionSettings; reviews: SecondOpinionRecord[] }

export type SecondOpinionStartInput = { checkpointSha: string; reviewer?: SecondOpinionReviewer; instructions?: string }

export type SecondOpinionService = {
  read(cwd: string, signal?: AbortSignal): Promise<SecondOpinionSnapshot>
  start(cwd: string, input: SecondOpinionStartInput): Promise<{ id: string }>
  cancel(cwd: string, id: string): Promise<void>
  dismiss(cwd: string, id: string, findingId: string): Promise<void>
  configure(cwd: string, settings: Partial<SecondOpinionSettings>): Promise<SecondOpinionSettings>
}

const SEVERITY_GLYPH: Record<SecondOpinionSeverity, string> = { bug: '✖', risk: '▲', nit: '·' }
export const secondOpinionGlyph = (severity: SecondOpinionSeverity) => SEVERITY_GLYPH[severity]

/** One phrase for a review: running, failed, clean, or its open counts. */
export function secondOpinionLabel(record: SecondOpinionRecord): string {
  if (record.status === 'running') return `${record.reviewer} reviewing…`
  if (record.status !== 'done' || !record.review) return record.status === 'failed' ? 'review failed' : record.status
  const open = record.review.findings.filter(finding => !record.dismissed.includes(finding.id))
  if (!open.length) return record.review.findings.length ? 'all dismissed' : 'no findings'
  const counts = { bug: 0, risk: 0, nit: 0 }
  for (const finding of open) counts[finding.severity]++
  return (['bug', 'risk', 'nit'] as const).filter(severity => counts[severity]).map(severity => `${counts[severity]} ${severity}${counts[severity] === 1 ? '' : 's'}`).join(' · ')
}

/** The newest review of a turn, if any. */
export function latestReviewFor(snapshot: SecondOpinionSnapshot | null, checkpointSha: string): SecondOpinionRecord | undefined {
  return snapshot?.reviews.find(record => record.checkpointSha === checkpointSha)
}

/** The open findings of a turn's newest settled review, with the record they came from. */
export function openFindingsFor(snapshot: SecondOpinionSnapshot | null, checkpointSha: string): { record: SecondOpinionRecord; findings: import('../secondOpinion/review').SecondOpinionFinding[] } | null {
  const record = snapshot?.reviews.find(entry => entry.checkpointSha === checkpointSha && entry.status === 'done' && entry.review)
  if (!record?.review) return null
  return { record, findings: record.review.findings.filter(finding => !record.dismissed.includes(finding.id)) }
}

/** The newest-turn review that still describes the working tree (not stale), for the working diff's hunks. */
export function workingTreeFindings(snapshot: SecondOpinionSnapshot | null): ReturnType<typeof openFindingsFor> {
  const record = snapshot?.reviews.find(entry => entry.untilSha === null && entry.status === 'done' && entry.review)
  if (!record?.review || record.stale) return null
  return { record, findings: record.review.findings.filter(finding => !record.dismissed.includes(finding.id)) }
}

type Finding = import('../secondOpinion/review').SecondOpinionFinding

/** Findings of a review read over exactly `checkpointSha`..`untilSha` (null: the working tree), else none: line numbers would not match. */
export function findingsForRange(snapshot: SecondOpinionSnapshot | null, checkpointSha: string, untilSha: string | null): Finding[] {
  const open = openFindingsFor(snapshot, checkpointSha)
  if (!open || open.record.stale || open.record.untilSha !== untilSha) return []
  return open.findings
}
const anchors = (finding: Finding) => finding.excerpts.map(excerpt => ({ path: excerpt.path, line: excerpt.startLine }))

/**
 * Which `git diff` line each finding belongs under: the line carrying the new-file number its
 * first excerpt starts at (a removed line counts as the number that follows it, as the review
 * numbered them). Keyed by line index; a finding is placed once. `file` scopes a one-file diff
 * that has no `diff --git` header of its own.
 */
export function placeFindingsInDiff(lines: readonly string[], findings: readonly Finding[], file?: string): Map<number, Finding[]> {
  const placed = new Map<number, Finding[]>()
  const pending = new Set(findings)
  let path = file ?? ''
  let next = 0
  for (let index = 0; index < lines.length && pending.size; index++) {
    const text = lines[index]!
    const header = /^diff --git a\/.+? b\/(.+)$/.exec(text)
    if (header) { path = header[1]!; next = 0; continue }
    const plus = /^\+\+\+ b\/(.+)$/.exec(text)
    if (plus) { path = plus[1]!; continue }
    if (text.startsWith('--- ') || text.startsWith('+++ ')) continue
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text)
    if (hunk) { next = Number(hunk[1]) || 1; continue }
    if (!next || text.startsWith('\\')) continue
    for (const finding of [...pending]) {
      if (anchors(finding).some(anchor => anchor.path === path && anchor.line === next)) {
        placed.set(index, [...(placed.get(index) ?? []), finding])
        pending.delete(finding)
      }
    }
    if (!text.startsWith('-')) next++
  }
  return placed
}

/** Findings about a file anywhere in it (an untracked file is one whole addition). */
export function findingsInFile(file: string, findings: readonly Finding[]): Finding[] {
  return findings.filter(finding => finding.excerpts.some(excerpt => excerpt.path === file))
}

/** Findings whose lines fall inside a working-diff hunk (`@@ -a,b +c,d @@` on `file`). */
export function findingsInHunk(hunk: { file: string; header: string }, findings: readonly Finding[]): Finding[] {
  const match = /\+(\d+)(?:,(\d+))?/.exec(hunk.header)
  if (!match) return []
  const start = Number(match[1])
  const end = start + Math.max(0, Number(match[2] ?? 1) - 1)
  return findings.filter(finding => finding.excerpts.some(excerpt => excerpt.path === hunk.file && excerpt.endLine >= start && excerpt.startLine <= end))
}
