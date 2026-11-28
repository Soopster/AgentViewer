'use client'

import { useState } from 'react'
import type { ReviewController } from '@/lib/review/useReview'
import type { ReviewHunk, ReviewTarget } from '@/lib/review/types'

/** Display retained notes, including those that cannot safely appear inline, and explicit review decisions. */
export function ReviewBoard({ review, onNavigate }: { review: ReviewController; onNavigate(target: ReviewTarget): void }) {
  const [expanded, setExpanded] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const { state, mutate } = review
  const approved = state.decisions.filter(item => item.status === 'approved').length
  const remaining = state.document.hunks.filter(hunk => !state.decisions.some(item => item.hunkId === hunk.id && item.status === 'approved'))
  const jump = (hunk: ReviewHunk) => onNavigate({ filePath: hunk.filePath, hunkId: hunk.id })
  return <section aria-label="Review checklist and notes" style={{ borderBottom: '1px solid var(--border)', padding: 8, color: 'var(--text)', background: 'var(--surface)', flexShrink: 0 }}>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>Review · {approved}/{state.document.hunks.length} approved · {state.notes.length} notes</button>
      <button type="button" disabled={!remaining.length} onClick={() => jump(remaining[0]!)}>Next unresolved</button>
    </div>
    {review.error ? <p role="alert">{review.error}</p> : null}
    {expanded ? <div style={{ maxHeight: 300, overflow: 'auto', display: 'grid', gap: 10, paddingTop: 8 }}>
      {state.document.hunks.map(hunk => {
        const decision = state.decisions.find(item => item.hunkId === hunk.id)
        return <div key={hunk.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => jump(hunk)}>{hunk.filePath} · hunk {hunk.index + 1}</button>
          <select aria-label={`Review status for ${hunk.filePath} hunk ${hunk.index + 1}`} value={decision?.status ?? 'unreviewed'} onChange={event => {
            void mutate({ type: 'decision', hunkId: hunk.id, status: event.target.value as 'approved' | 'investigate' | 'blocked' | 'unreviewed', revision: state.document.revision, rationale: decision?.rationale }).catch(() => {})
          }}>
            <option value="unreviewed">Unreviewed</option><option value="approved">Approved</option><option value="investigate">Investigate</option><option value="blocked">Blocked</option>
          </select>
          {decision ? <input key={`${hunk.id}:${decision.status}`} aria-label={`Rationale for ${hunk.filePath} hunk ${hunk.index + 1}`} placeholder="Optional rationale" defaultValue={decision.rationale} maxLength={4000} onBlur={event => {
            if (event.target.value !== decision.rationale) void mutate({ type: 'decision', hunkId: hunk.id, status: decision.status, rationale: event.target.value, revision: state.document.revision }).catch(() => {})
          }} /> : null}
        </div>
      })}
      {state.notes.map(note => <article key={note.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <div>{note.author === 'agent' ? 'Agent' : 'You'} · {note.filePath} · {note.resolution}{note.resolved ? ' · resolved' : ''}</div>
        <p style={{ whiteSpace: 'pre-wrap' }}>{note.text}</p>
        {note.resolution !== 'active' ? <p>This note refers to an earlier version. Its original location is retained; it is not attached to the current code.</p> : <button type="button" onClick={() => onNavigate({ filePath: note.filePath, range: note.range, noteId: note.id })}>Show code</button>}
        {note.replies.map(item => <p key={item.id} style={{ whiteSpace: 'pre-wrap', paddingLeft: 12 }}>{item.author === 'agent' ? 'Agent' : 'You'}: {item.text}</p>)}
        <button type="button" onClick={() => { setReplyTo(note.id); setReply('') }}>Reply</button>{' '}
        <button type="button" onClick={() => { void mutate({ type: 'resolve', noteId: note.id, resolved: !note.resolved, expectedVersion: note.version }).catch(() => {}) }}>{note.resolved ? 'Reopen' : 'Resolve'}</button>
        {replyTo === note.id ? <form onSubmit={event => {
          event.preventDefault()
          void mutate({ type: 'reply', noteId: note.id, text: reply, author: 'user' }).then(() => { setReplyTo(null); setReply('') }).catch(() => {})
        }}>
          <textarea aria-label="Review reply" value={reply} onChange={event => setReply(event.target.value)} maxLength={16000} />
          <button type="submit" disabled={!reply.trim()}>Save reply</button>
          <button type="button" onClick={() => setReplyTo(null)}>Cancel</button>
        </form> : null}
      </article>)}
    </div> : null}
  </section>
}
