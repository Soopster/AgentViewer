import type { SelectedLineRange } from '@pierre/diffs'

export type ReviewLine = { text: string; oldLine?: number; newLine?: number }
export type ReviewHunk = { id: string; filePath: string; index: number; header: string; lines: ReviewLine[] }
export type ReviewDocument = { revision: string; files: string[]; hunks: ReviewHunk[] }
export type ReviewReply = { id: string; text: string; author: 'user' | 'agent'; createdAt: number }
export type ReviewNote = {
  id: string; filePath: string; range: SelectedLineRange; text: string
  author: 'user' | 'agent'; replies: ReviewReply[]; resolved: boolean
  createdAt: number; updatedAt: number; version: number
  anchor?: { hunkId: string; oldStart: number; newStart: number }
  resolution: 'active' | 'stale' | 'orphaned'
}
export type ReviewDecision = { hunkId: string; status: 'approved' | 'investigate' | 'blocked'; rationale: string; updatedAt: number }
export type ReviewTarget = { filePath: string; hunkId?: string; noteId?: string; range?: SelectedLineRange }
export type ReviewView = {
  id: string; surface: string; seenAt: number; revision: string
  navigation?: { id: string; target: ReviewTarget; requestedAt: number; appliedAt?: number }
}
export type ReviewSnapshot = {
  version: 1; sequence: number; source: string; document: ReviewDocument
  notes: ReviewNote[]; decisions: ReviewDecision[]; views: ReviewView[]
  receipts: string[]; migrated?: boolean
}
export type ReviewOperation =
  | { type: 'note'; revision: string; id?: string; expectedVersion?: number; filePath: string; range: SelectedLineRange; text: string; author: 'user' | 'agent' }
  | { type: 'reply'; noteId: string; text: string; author: 'user' | 'agent' }
  | { type: 'resolve'; noteId: string; resolved: boolean; expectedVersion: number }
  | { type: 'delete'; noteId: string; expectedVersion: number }
  | { type: 'decision'; hunkId: string; status: ReviewDecision['status'] | 'unreviewed'; rationale?: string; revision: string }
  | { type: 'navigate'; viewId: string; target: ReviewTarget; revision: string }
  | { type: 'ack'; viewId: string; navigationId: string }

export type ReviewRequest = {
  cwd: string; source: string; requestId: string
  operation?: ReviewOperation
  publish?: { patch?: string; refresh?: boolean; viewId: string; surface: string; close?: boolean }
}

/** Preserve the existing range-keyed inline annotation adapters. Stable IDs live in the store. */
export function reviewRangeKey(filePath: string, range: SelectedLineRange): string {
  return [filePath, range.start, range.side ?? 'additions', range.end, range.endSide ?? range.side ?? 'additions'].join('\u0000')
}

export function emptyReview(source: string): ReviewSnapshot {
  return { version: 1, sequence: 0, source, document: { revision: '', files: [], hunks: [] }, notes: [], decisions: [], views: [], receipts: [] }
}
