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
    setComments((current) => {
      const key = buildDiffCommentKey(filePath, range)
      const existing = current.get(key)
      setDraft({ key, filePath, range, text: existing?.text ?? '', replyToKey: null })
      return current
    })
  }, [filePath])

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
            <div style={{
              color: 'var(--cyan)',
              fontSize: 12,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              Draft comment
            </div>
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
            value={draft?.text ?? metadata.text}
            onChange={(event) => {
              setDraft((current) => current ? { ...current, text: event.target.value } : current)
            }}
            placeholder="Write a comment..."
            rows={4}
            style={{ ...TEXTAREA_STYLE, minHeight: 84 }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" onClick={cancelDraft} style={GHOST_BUTTON_STYLE}>Cancel</button>
            <button type="button" onClick={saveDraft} style={SAVE_BUTTON_STYLE}>Save comment</button>
          </div>
        </div>
      )
    }

    if (!thread) return null

    return (
      <div style={{
        display: 'grid',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 12,
        border: thread.resolved ? '1px solid color-mix(in srgb, var(--text-3) 24%, var(--border))' : '1px solid color-mix(in srgb, var(--violet) 24%, var(--border))',
        background: thread.resolved ? 'color-mix(in srgb, var(--text-3) 6%, var(--surface-2))' : 'color-mix(in srgb, var(--violet) 8%, var(--surface-2))',
        opacity: thread.resolved ? 0.72 : 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--violet)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 12,
              fontWeight: 700,
            }}>
              You
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                color: 'var(--text)',
                fontSize: 13,
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                You
              </div>
              <div style={{
                color: 'var(--text-3)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                whiteSpace: 'nowrap',
              }}>
                {metadata.rangeLabel}
                {' · '}
                {formatCommentAge(thread.createdAt)}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggleResolved(threadKey)}
            style={{
              height: 28,
              padding: '0 10px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-2)',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {thread.resolved ? 'Reopen' : 'Resolve'}
          </button>
        </div>
        <div style={{
          color: 'var(--text)',
          fontSize: 12,
          lineHeight: '18px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {thread.text}
        </div>
        {thread.replies.length > 0 ? (
          <div style={{ display: 'grid', gap: 8, paddingLeft: 12, borderLeft: '1px solid color-mix(in srgb, var(--border) 70%, transparent)' }}>
            {thread.replies.map((reply) => (
              <div key={reply.id} style={{ display: 'grid', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-2)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>
                    R
                  </div>
                  <div style={{ color: 'var(--text-3)', fontSize: 11 }}>Reply · {formatCommentAge(reply.createdAt)}</div>
                </div>
                <div style={{ color: 'var(--text)', fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap' }}>
                  {reply.text}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {draft?.replyToKey === threadKey ? (
          <div style={{
            display: 'grid',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid color-mix(in srgb, var(--cyan) 28%, var(--border))',
            background: 'color-mix(in srgb, var(--cyan) 7%, var(--surface))',
          }}>
            <div style={{ color: 'var(--cyan)', fontSize: 12, fontWeight: 700 }}>
              Add reply
            </div>
            <textarea
              value={draft?.text ?? ''}
              onChange={(event) => setDraft((current) => current ? { ...current, text: event.target.value } : current)}
              placeholder="Write a reply..."
              rows={3}
              style={TEXTAREA_STYLE}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={cancelDraft} style={GHOST_BUTTON_STYLE}>Cancel</button>
              <button type="button" onClick={saveDraft} style={SAVE_BUTTON_STYLE}>Save reply</button>
            </div>
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => openReplyDraft(thread)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--cyan)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Add reply...
            </button>
            {onSendToComposer ? (
              <button
                type="button"
                onClick={() => onSendToComposer(thread)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--green)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                Send to composer
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => deleteComment(threadKey)}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text-3)',
              cursor: 'pointer',
              padding: 0,
              fontSize: 11,
            }}
          >
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
