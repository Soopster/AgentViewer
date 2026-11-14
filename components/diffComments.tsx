'use client'

import { useCallback, useMemo, useState } from 'react'
import type { SelectedLineRange } from '@pierre/diffs'
import type { PierreAnnotationMetadata, PierreDiffAnnotation } from './PierreDiffView'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiffCommentReply = {
  id: string
  text: string
  createdAt: number
}

export type DiffComment = {
  filePath: string
  range: SelectedLineRange
  text: string
  replies: DiffCommentReply[]
  resolved: boolean
  createdAt: number
  updatedAt: number
}

type DraftDiffComment = {
  key: string
  filePath: string
  range: SelectedLineRange
  text: string
  replyToKey?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSelectedRange(range: SelectedLineRange): string {
  if (range.start === range.end) return `Line ${range.start}`
  return `Lines ${range.start}-${range.end}`
}

function formatSelectedRangeForNote(range: SelectedLineRange): string {
  const base = formatSelectedRange(range)
  const sides = [range.side, range.endSide].filter((side): side is NonNullable<SelectedLineRange['side']> => side != null)
  if (sides.length === 0) return base
  if (sides.length === 1) return `${base} (${sides[0]})`
  return `${base} (${sides[0]} → ${sides[1]})`
}

function buildDiffCommentKey(filePath: string, range: SelectedLineRange): string {
  return [filePath, range.start, range.side ?? '', range.end, range.endSide ?? ''].join('\u0000')
}

function buildReplyId(key: string): string {
  return `${key}\u0000${Date.now().toString(36)}\u0000${Math.random().toString(36).slice(2, 8)}`
}

function buildAnnotationSide(range: SelectedLineRange): PierreDiffAnnotation<PierreAnnotationMetadata>['side'] {
  const side = range.side ?? range.endSide ?? 'additions'
  return side === 'deletions' ? 'deletions' : 'additions'
}

function formatCommentAge(time: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}

const TEXTAREA_STYLE: React.CSSProperties = {
  width: '100%',
  minHeight: 72,
  resize: 'vertical',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  padding: '9px 10px',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 12,
  lineHeight: '18px',
  outline: 'none',
}

const GHOST_BUTTON_STYLE: React.CSSProperties = {
  height: 28,
  padding: '0 10px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--surface-3)',
  color: 'var(--text-2)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
}

const SAVE_BUTTON_STYLE: React.CSSProperties = {
  height: 28,
  padding: '0 10px',
  borderRadius: 999,
  border: '1px solid color-mix(in srgb, var(--green) 34%, var(--border))',
  background: 'color-mix(in srgb, var(--green) 12%, var(--surface-3))',
  color: 'var(--green)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
}

function CommentEntry({ label, age, meta, text, resolved, small }: { label: string; age: string; meta?: string; text: string; resolved?: boolean; small?: boolean }) {
  const size = small ? 26 : 30
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `${size}px 1fr`, columnGap: 10, alignItems: 'start' }}>
      <div aria-hidden style={{
        width: size, height: size, borderRadius: 999, background: 'color-mix(in srgb, var(--violet) 18%, var(--surface))',
        border: '1px solid color-mix(in srgb, var(--violet) 34%, var(--border))', color: 'var(--violet)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: small ? 10 : 11, fontWeight: 700,
      }}>
        {label.slice(0, 1).toUpperCase()}
      </div>
      <div style={{ minWidth: 0, display: 'grid', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>{label}</strong>
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{age}</span>
          {meta ? <span style={{ color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 10 }}>{meta}</span> : null}
          {resolved ? <span style={{ color: 'var(--green)', fontSize: 11, fontWeight: 600 }}>Resolved</span> : null}
        </div>
        <div style={{ color: 'var(--text)', fontSize: 13, lineHeight: '20px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</div>
      </div>
    </div>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Ephemeral (in-memory, not persisted) line-comment threads for a single diff
 * region — mirrors GitPopover's annotation system so reviewers can leave notes
 * directly on agent-authored edits while reading the transcript.
 */
export function useDiffComments(
  filePath: string,
  options: { onSendToComposer?: (comment: DiffComment) => void } = {},
) {
  const { onSendToComposer } = options
  const [comments, setComments] = useState<Map<string, DiffComment>>(() => new Map())
  const [draft, setDraft] = useState<DraftDiffComment | null>(null)
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null)

  const openDraftForRange = useCallback((range: SelectedLineRange) => {
    setSelectedLines(range)
    const key = buildDiffCommentKey(filePath, range)
    const existing = comments.get(key)
    setDraft({ key, filePath, range, text: existing?.text ?? '', replyToKey: null })
  }, [comments, filePath])

  function openReplyDraft(comment: DiffComment) {
    const threadKey = buildDiffCommentKey(comment.filePath, comment.range)
    setDraft({
      key: `${threadKey}\u0000reply`,
      filePath: comment.filePath,
      range: comment.range,
      text: '',
      replyToKey: threadKey,
    })
  }

  function saveDraft() {
    if (!draft) return
    const text = draft.text.trim()
    setComments((prev) => {
      const next = new Map(prev)
      if (draft.replyToKey) {
        if (!text) return prev
        const thread = next.get(draft.replyToKey)
        if (!thread) return prev
        const now = Date.now()
        next.set(draft.replyToKey, {
          ...thread,
          replies: [...thread.replies, { id: buildReplyId(draft.replyToKey), text, createdAt: now }],
          updatedAt: now,
        })
      } else if (text) {
        const existing = next.get(draft.key)
        next.set(draft.key, {
          filePath: draft.filePath,
          range: draft.range,
          text,
          replies: existing?.replies ?? [],
          resolved: existing?.resolved ?? false,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        })
      } else {
        next.delete(draft.key)
      }
      return next
    })
    setDraft(null)
    setSelectedLines(null)
  }

  function cancelDraft() {
    setDraft(null)
  }

  function toggleResolved(key: string) {
    setComments((prev) => {
      const comment = prev.get(key)
      if (!comment) return prev
      const next = new Map(prev)
      next.set(key, { ...comment, resolved: !comment.resolved, updatedAt: Date.now() })
      return next
    })
  }

  function deleteComment(key: string) {
    setComments((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    setDraft((current) => (current?.key === key ? null : current))
  }

  const lineAnnotations = useMemo<PierreDiffAnnotation<PierreAnnotationMetadata>[]>(() => {
    const annotations: PierreDiffAnnotation<PierreAnnotationMetadata>[] = [...comments.values()].map((comment) => ({
      side: buildAnnotationSide(comment.range),
      lineNumber: comment.range.start,
      metadata: {
        filePath: comment.filePath,
        noteId: buildDiffCommentKey(comment.filePath, comment.range),
        text: comment.text,
        rangeLabel: formatSelectedRangeForNote(comment.range),
        kind: 'thread' as const,
      },
    }))
    if (draft && !draft.replyToKey) {
      annotations.push({
        side: buildAnnotationSide(draft.range),
        lineNumber: draft.range.start,
        metadata: {
          filePath: draft.filePath,
          noteId: draft.key,
          text: draft.text,
          rangeLabel: formatSelectedRangeForNote(draft.range),
          kind: 'draft' as const,
        },
      })
    }
    return annotations
  }, [comments, draft])

  const currentSelectionNote = useMemo(() => {
    if (!selectedLines) return null
    return comments.get(buildDiffCommentKey(filePath, selectedLines)) ?? null
  }, [comments, filePath, selectedLines])

  const renderAnnotation = useCallback((annotation: PierreDiffAnnotation<PierreAnnotationMetadata>) => {
    const metadata = annotation.metadata
    if (!metadata) return null

    const threadKey = metadata.noteId.endsWith('\u0000reply')
      ? metadata.noteId.slice(0, metadata.noteId.length - '\u0000reply'.length)
      : metadata.noteId
    const thread = comments.get(threadKey)
    const isDraft = metadata.kind === 'draft'

    if (isDraft) {
      return (
        <div style={{
          display: 'grid',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 12,
          border: '1px solid color-mix(in srgb, var(--cyan) 30%, var(--border))',
          background: 'color-mix(in srgb, var(--cyan) 8%, var(--surface-2))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
            <label htmlFor="diff-comment-draft" style={{
              color: 'var(--cyan)',
              fontSize: 12,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              Draft comment
            </label>
            <div style={{
              color: 'var(--text-3)',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 10,
              whiteSpace: 'nowrap',
            }}>
              {metadata.rangeLabel}
            </div>
          </div>
          <textarea
            id="diff-comment-draft"
            value={draft?.text ?? metadata.text}
            onChange={(event) => {
              setDraft((current) => current ? { ...current, text: event.target.value } : current)
            }}
            placeholder="Write a comment..."
            rows={4}
            style={{ ...TEXTAREA_STYLE, minHeight: 84 }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="av-hover-control" onClick={cancelDraft} style={GHOST_BUTTON_STYLE}>Cancel</button>
            <button type="button" className="av-hover-control" onClick={saveDraft} style={SAVE_BUTTON_STYLE}>Save comment</button>
          </div>
        </div>
      )
    }

    if (!thread) return null

    const linkButton = (color: string): React.CSSProperties => ({
      border: 'none', background: 'transparent', color, cursor: 'pointer', padding: 0, fontSize: 12, fontWeight: 500,
      display: 'inline-flex', alignItems: 'center', gap: 5,
    })

    // A thread reads as a conversation: author, age, text; replies indented beneath
    // with their own header; the actions sit at the foot as plain links.
    return (
      <div style={{
        display: 'grid',
        gap: 14,
        padding: '14px 16px',
        margin: '6px 0',
        borderRadius: 14,
        border: '1px solid color-mix(in srgb, var(--text-3) 22%, var(--border))',
        background: 'var(--surface-2)',
        opacity: thread.resolved ? 0.62 : 1,
      }}>
        <CommentEntry label="You" age={formatCommentAge(thread.createdAt)} meta={metadata.rangeLabel} text={thread.text} resolved={thread.resolved} />
        {thread.replies.length > 0 ? (
          <div style={{ display: 'grid', gap: 12, paddingLeft: 38 }}>
            {thread.replies.map((reply) => (
              <CommentEntry key={reply.id} label="You" age={formatCommentAge(reply.createdAt)} text={reply.text} small />
            ))}
          </div>
        ) : null}
        {draft?.replyToKey === threadKey ? (
          <div style={{ display: 'grid', gap: 8, paddingLeft: 38 }}>
            <label htmlFor="diff-comment-reply" style={{ color: 'var(--cyan)', fontSize: 12, fontWeight: 600 }}>Add reply</label>
            <textarea
              id="diff-comment-reply"
              autoFocus
              value={draft?.text ?? ''}
              onChange={(event) => setDraft((current) => current ? { ...current, text: event.target.value } : current)}
              placeholder="Write a reply..."
              rows={3}
              style={TEXTAREA_STYLE}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="av-hover-control" onClick={cancelDraft} style={GHOST_BUTTON_STYLE}>Cancel</button>
              <button type="button" className="av-hover-control" onClick={saveDraft} style={SAVE_BUTTON_STYLE}>Save reply</button>
            </div>
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingLeft: 38 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <button type="button" className="av-hover-control" onClick={() => openReplyDraft(thread)} style={linkButton('var(--cyan)')}>
              <span aria-hidden>↳</span> Add reply…
            </button>
            <button type="button" className="av-hover-control" onClick={() => toggleResolved(threadKey)} style={linkButton('var(--cyan)')}>
              {thread.resolved ? 'Reopen' : 'Resolve'}
            </button>
            {onSendToComposer ? (
              <button type="button" className="av-hover-control" onClick={() => onSendToComposer(thread)} style={linkButton('var(--green)')}>
                Send to composer
              </button>
            ) : null}
          </div>
          <button type="button" className="av-hover-control" onClick={() => deleteComment(threadKey)} style={{ ...linkButton('var(--text-3)'), fontSize: 11 }}>
            Delete
          </button>
        </div>
      </div>
    )
  }, [comments, draft, onSendToComposer])

  return {
    selectedLines,
    onSelectedLinesChange: setSelectedLines,
    onGutterUtilityClick: openDraftForRange,
    lineAnnotations,
    renderAnnotation,
    commentCount: comments.size,
    currentSelectionNote,
  }
}
