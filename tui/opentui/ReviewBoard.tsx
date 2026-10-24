/** @jsxImportSource @opentui/react */
import { useEffect, useState, type MutableRefObject } from 'react'
import type { ReviewController } from '../../lib/review/useReview'
import type { ReviewTarget } from '../../lib/review/types'
import type { TuiThemePalette } from '../theme'

export type ReviewBoardKey = { name?: string; sequence?: string; ctrl?: boolean }

/** Keep the board's keyboard handling inside the owning popover's capture path. */
export function ReviewBoard({ review, theme, width, height, keyRef, onClose, onNavigate }: {
  review: ReviewController; theme: TuiThemePalette; width: number; height: number
  keyRef: MutableRefObject<(key: ReviewBoardKey) => void>; onClose(): void; onNavigate(target: ReviewTarget): void
}) {
  const [cursor, setCursor] = useState(0)
  const [draft, setDraft] = useState<{ kind: 'reply' | 'rationale'; id: string; text: string } | null>(null)
  const { state, mutate } = review
  const entries = [
    ...state.document.hunks.map(hunk => ({ kind: 'hunk' as const, hunk })),
    ...state.notes.map(note => ({ kind: 'note' as const, note })),
  ]
  const index = Math.min(cursor, Math.max(0, entries.length - 1))
  const selected = entries[index]
  useEffect(() => {
    keyRef.current = key => {
      if (draft) {
        if (key.name === 'escape') { setDraft(null); return }
        if (key.name === 'return') {
          const operation = draft.kind === 'reply'
            ? { type: 'reply' as const, noteId: draft.id, text: draft.text, author: 'user' as const }
            : { type: 'decision' as const, hunkId: draft.id, status: state.decisions.find(item => item.hunkId === draft.id)?.status ?? 'investigate', rationale: draft.text, revision: state.document.revision }
          void mutate(operation).then(() => setDraft(null)).catch(() => {})
        } else if (key.name === 'backspace') setDraft({ ...draft, text: draft.text.slice(0, -1) })
        else if (!key.ctrl && key.sequence && !/[\x00-\x1f\x7f]/.test(key.sequence)) setDraft({ ...draft, text: (draft.text + key.sequence).slice(0, 4000) })
        return
      }
      if (key.name === 'escape' || key.sequence === 'q') { onClose(); return }
      if (key.name === 'down' || key.sequence === 'j') setCursor(Math.min(index + 1, entries.length - 1))
      if (key.name === 'up' || key.sequence === 'k') setCursor(Math.max(0, index - 1))
      if (key.sequence === 'n') {
        const next = entries.findIndex((entry, position) => position > index && entry.kind === 'hunk' && !state.decisions.some(item => item.hunkId === entry.hunk.id && item.status === 'approved'))
        const first = entries.findIndex(entry => entry.kind === 'hunk' && !state.decisions.some(item => item.hunkId === entry.hunk.id && item.status === 'approved'))
        if (next >= 0 || first >= 0) setCursor(next >= 0 ? next : first)
      }
      if (key.name === 'return' && selected) {
        if (selected.kind === 'hunk') onNavigate({ filePath: selected.hunk.filePath, hunkId: selected.hunk.id })
        else if (selected.note.resolution === 'active') onNavigate({ filePath: selected.note.filePath, range: selected.note.range, noteId: selected.note.id })
      }
      if (selected?.kind === 'hunk') {
        const statuses = { a: 'approved', i: 'investigate', b: 'blocked', u: 'unreviewed' } as const
        const status = statuses[key.sequence as keyof typeof statuses]
        if (status) void mutate({ type: 'decision', hunkId: selected.hunk.id, status, revision: state.document.revision }).catch(() => {})
        if (key.sequence === 'r') setDraft({ kind: 'rationale', id: selected.hunk.id, text: state.decisions.find(item => item.hunkId === selected.hunk.id)?.rationale ?? '' })
      } else if (selected) {
        if (key.sequence === 'r') setDraft({ kind: 'reply', id: selected.note.id, text: '' })
        if (key.sequence === 'x') void mutate({ type: 'resolve', noteId: selected.note.id, resolved: !selected.note.resolved, expectedVersion: selected.note.version }).catch(() => {})
      }
    }
    return () => { keyRef.current = () => {} }
  }, [draft, entries, index, keyRef, mutate, onClose, onNavigate, selected, state])
  const rows = Math.max(2, height - 13)
  const start = Math.max(0, index - rows + 1)
  const detail = selected?.kind === 'note'
    ? `${selected.note.author}: ${selected.note.text}\n${selected.note.replies.map(reply => `${reply.author}: ${reply.text}`).join('\n')}`
    : selected ? state.decisions.find(item => item.hunkId === selected.hunk.id)?.rationale ?? selected.hunk.header : 'No review hunks'
  return <box position="absolute" top={0} left={0} width={width} height={height} zIndex={200} backgroundColor={theme.bg} border borderColor={theme.violet} flexDirection="column" paddingX={1}>
    <text fg={theme.violet}>Review · {state.decisions.filter(item => item.status === 'approved').length}/{state.document.hunks.length} approved · {state.notes.length} notes</text>
    <text fg={theme.dim}>j/k move · enter show · a approve · i investigate · b block · u clear · n next unresolved</text>
    <text fg={theme.dim}>r rationale/reply · x resolve/reopen note · esc close</text>
    {entries.slice(start, start + rows).map((entry, offset) => <text key={entry.kind === 'hunk' ? entry.hunk.id : entry.note.id} fg={start + offset === index ? theme.cyan : theme.text} wrapMode="none">
      {start + offset === index ? '> ' : '  '}{entry.kind === 'hunk'
        ? `${state.decisions.find(item => item.hunkId === entry.hunk.id)?.status ?? 'unreviewed'} · ${entry.hunk.filePath} hunk ${entry.hunk.index + 1}`
        : `${entry.note.resolution}${entry.note.resolved ? '/resolved' : ''} · ${entry.note.author} · ${entry.note.filePath}: ${entry.note.text}`}
    </text>)}
    <box flexGrow={1} />
    <text fg={theme.text} height={4} wrapMode="word">{detail}</text>
    {draft ? <text fg={theme.cyan} height={2} wrapMode="word">{draft.kind}: {draft.text}▏ (enter save · esc cancel)</text> : null}
    {review.error ? <text fg={theme.red} wrapMode="word">{review.error}</text> : null}
  </box>
}
