import type { TuiTranscriptCard } from '../../../../tui/format'
import type { PersistedFileEditRecord } from '../../../../lib/session-index/types'
import type { SessionProvenanceResult } from '../../../../lib/provenance'
import { mergeFileEditStats, type FileEditStat } from '../../../../lib/turnEditStats'

/** `surviving`: lines of this file still attributed to the session (provenance only). `edits`: recorded edit count. */
export type TouchedFile = FileEditStat & { surviving?: number | null; edits?: number }
export type TouchedTurn = { key: string; title: string; files: TouchedFile[]; added: number; removed: number }
export type TouchedRow =
  | { kind: 'turn'; key: string; title: string; fileCount: number; added: number; removed: number }
  | { kind: 'file'; key: string; path: string; added: number; removed: number; surviving?: number | null; edits?: number }

type WithNested = TuiTranscriptCard & { agentToolCards?: readonly TuiTranscriptCard[] }

function turnTitle(card: TuiTranscriptCard): string {
  const text = card.lines.map((line) => line.text).find((value) => value.trim()) ?? 'prompt'
  return text.replace(/^(prompt|you|user)\s*[:·-]?\s*/i, '').replace(/\s+/g, ' ').trim() || 'prompt'
}

/** One entry per prompt that was followed by edits, newest first. Edits before the first prompt belong to "earlier". */
export function touchedTurns(cards: readonly TuiTranscriptCard[]): TouchedTurn[] {
  const turns: Array<{ key: string; title: string; groups: Array<readonly FileEditStat[] | undefined> }> = []
  let current: (typeof turns)[number] = { key: 'earlier', title: 'earlier', groups: [] }
  turns.push(current)
  for (const card of cards) {
    if (card.role === 'user') {
      current = { key: card.key, title: turnTitle(card), groups: [] }
      turns.push(current)
      continue
    }
    for (const inner of (card as WithNested).agentToolCards ?? [card]) current.groups.push(inner.fileEdits)
  }
  return turns
    .map((turn) => {
      const files = mergeFileEditStats(turn.groups)
      return {
        key: turn.key,
        title: turn.title,
        files,
        added: files.reduce((sum, file) => sum + file.added, 0),
        removed: files.reduce((sum, file) => sum + file.removed, 0),
      }
    })
    .filter((turn) => turn.files.length > 0)
    .reverse()
}

export function touchedRows(turns: readonly TouchedTurn[]): TouchedRow[] {
  return turns.flatMap((turn): TouchedRow[] => [
    { kind: 'turn', key: `turn:${turn.key}`, title: turn.title, fileCount: turn.files.length, added: turn.added, removed: turn.removed },
    ...turn.files.map((file): TouchedRow => ({ kind: 'file', key: `file:${turn.key}:${file.path}`, path: file.path, added: file.added, removed: file.removed, surviving: file.surviving, edits: file.edits })),
  ])
}

export function relativeTo(cwd: string | undefined, path: string): string {
  if (!cwd) return path
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The provenance index's view: one entry per prompt that led to edits, newest first, a file once per turn with
 * the lines recorded and how many of the file's current lines still trace to this session. The index keeps added
 * lines only, so `removed` is 0. Edits with no recorded prompt (or before the first) fall under "earlier". */
export function touchedTurnsFromProvenance(edits: readonly PersistedFileEditRecord[], summary: SessionProvenanceResult | null): TouchedTurn[] {
  const surviving = new Map((summary?.files ?? []).map((file) => [file.filePath, file.linesSurviving]))
  const ordered = [...edits].sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0) || a.id - b.id)
  const turns = new Map<string, { title: string; at: number; files: Map<string, TouchedFile> }>()
  for (const edit of ordered) {
    const prompt = edit.prompt ? oneLine(edit.prompt) : ''
    const key = prompt || 'earlier'
    let turn = turns.get(key)
    if (!turn) { turn = { title: prompt || 'earlier', at: edit.timestampMs ?? 0, files: new Map() }; turns.set(key, turn) }
    const file = turn.files.get(edit.filePath) ?? { path: edit.filePath, added: 0, removed: 0, edits: 0, surviving: surviving.get(edit.filePath) }
    file.added += edit.addedLines.length
    file.edits = (file.edits ?? 0) + 1
    turn.files.set(edit.filePath, file)
  }
  return [...turns.entries()]
    .map(([key, turn]) => {
      const files = [...turn.files.values()]
      return { key, title: turn.title, files, added: files.reduce((sum, file) => sum + file.added, 0), removed: 0, at: turn.at }
    })
    .sort((a, b) => b.at - a.at)
    .map(({ at: _at, ...turn }) => turn)
}
