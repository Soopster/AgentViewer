'use client'

// First-class review surface for an IDE-bridge openDiff request. When the
// connected `claude` session proposes a change (a blocking openDiff call), this
// centered overlay renders the real old-vs-new diff in agentViewer's own Pierre
// diff viewer so the change can be reviewed properly before Accept (FILE_SAVED)
// or Reject (DIFF_REJECTED). This is the one IDE tool that genuinely beats the
// raw terminal — so it gets the full diff UI rather than a one-line card.
//
// See channels/agentviewer-ide.ts (openDiff is blocking) and lib/ideBridge.ts.

import React, { useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { Check, FileCode2, PencilLine, X } from 'lucide-react'
import type { IdeOpenDiffEvent } from '@/lib/ideBridge'
import { useDiffComments } from './diffComments'
import { buildDiffCommentComposerPrompt } from '@/lib/diffCommentComposer'

// Reuse the Edit-card diff renderer (old/new strings → Pierre engine). Loaded
// lazily — the heavy diff bundle only arrives when a diff is actually reviewed.
const DiffView = dynamic(() => import('./CodeRenderers').then((mod) => ({ default: mod.DiffView })), {
  ssr: false,
  loading: () => <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 12 }}>Loading diff…</div>,
})

export type IdeDiffReviewAccent = { cssVar: string; cssRgb: string }

function shortPath(value: string): string {
  return value.replace(/^file:\/\//, '')
}

// Mirror buildEditDiffContext (MessageItem) so a diff comment carries the same
// old/new context block the Edit-card comments do.
function buildDiffContext(oldStr: string, newStr: string): string {
  const block = (prefix: string, text: string) =>
    text === '' ? `${prefix} ` : text.split('\n').map((line) => `${prefix} ${line}`).join('\n')
  return ['--- original', block('-', oldStr), '+++ updated', block('+', newStr)].join('\n')
}

export default function IdeDiffReviewOverlay({
  request,
  accent,
  onResolve,
  onClose,
  onSendComment,
}: {
  request: IdeOpenDiffEvent
  accent: IdeDiffReviewAccent
  onResolve: (behavior: 'accept' | 'reject') => void
  onClose: () => void
  // Deliver a review comment (built into a structured prompt) to the composer.
  // When absent, line commenting is hidden.
  onSendComment?: (text: string) => void
}) {
  const accentColor = `var(${accent.cssVar})`
  const accentBg = `rgba(${accent.cssRgb},0.16)`
  const accentBorder = `rgba(${accent.cssRgb},0.4)`

  // Line comments on the proposed change — the same machinery the Edit-tool
  // card uses. "Send to composer" on a thread builds a structured prompt
  // (file + range + note + diff) and hands it to onSendComment so it can be
  // sent to the session as review feedback (typically alongside a Reject).
  const diffContext = useMemo(
    () => buildDiffContext(request.old_file_contents, request.new_file_contents),
    [request.old_file_contents, request.new_file_contents],
  )
  const comments = useDiffComments(request.new_file_path, {
    onSendToComposer: onSendComment
      ? (comment) =>
          onSendComment(
            buildDiffCommentComposerPrompt({
              filePath: request.new_file_path,
              range: comment.range,
              comment: comment.text,
              context: diffContext,
              source: 'IDE bridge diff',
            }),
          )
      : undefined,
  })

  // Esc dismisses the overlay back to the panel (the diff stays pending — the
  // user can still accept/reject from the card). It does NOT auto-reject, so a
  // stray keypress can't silently discard the session's proposed change. Skip
  // when typing in a comment box so Esc-to-close doesn't eat draft edits.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const newPath = shortPath(request.new_file_path || request.old_file_path)
  const isNewFile = request.old_file_contents.length === 0 && request.old_file_path !== request.new_file_path

  return (
    <div
      role="dialog"
      aria-label="Review proposed change"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(1100px, 90vw)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '10px 14px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)',
            flexShrink: 0,
          }}
        >
          <FileCode2 size={16} color={accentColor} />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
              {request.tab_name}
            </span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {newPath}{isNewFile ? ' · new file' : ''} · the session is blocked until you respond
            </span>
          </div>
          <div style={{ flex: 1 }} />
          {comments.commentCount > 0 ? (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
              {comments.commentCount} comment{comments.commentCount === 1 ? '' : 's'}
            </span>
          ) : null}
          {onSendComment && comments.selectedLines ? (
            <button
              type="button"
              className="av-hover-control"
              onClick={() => comments.selectedLines && comments.onGutterUtilityClick(comments.selectedLines)}
              title={comments.currentSelectionNote ? 'Edit comment for selected lines' : 'Add comment for selected lines'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                height: 28,
                padding: '0 10px',
                borderRadius: 999,
                border: `1px solid ${comments.currentSelectionNote ? accentBorder : 'var(--border)'}`,
                background: comments.currentSelectionNote ? accentBg : 'var(--surface-3)',
                color: comments.currentSelectionNote ? accentColor : 'var(--text-2)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <PencilLine size={12} />
              {comments.currentSelectionNote ? 'Edit comment' : 'Add comment'}
            </button>
          ) : null}
          <button
            type="button"
            className="av-hover-control"
            onClick={onClose}
            title="Back to panel (esc) — leaves the change pending"
            aria-label="Close"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'transparent', border: 'none', borderRadius: 6, color: 'var(--text-3)', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>

        {onSendComment ? (
          <div style={{ padding: '5px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', fontSize: 10.5, color: 'var(--text-3)' }}>
            Select lines in the diff to comment. Each comment can be sent to the composer as feedback — pair it with Reject to ask the session to revise.
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, background: 'var(--surface)' }}>
          <DiffView
            oldStr={request.old_file_contents}
            newStr={request.new_file_contents}
            filePath={request.new_file_path}
            selectedLines={comments.selectedLines}
            onSelectedLinesChange={comments.onSelectedLinesChange}
            lineAnnotations={comments.lineAnnotations}
            renderAnnotation={comments.renderAnnotation}
            onGutterUtilityClick={comments.onGutterUtilityClick}
          />
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '10px 14px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface-2)',
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1, alignSelf: 'center', fontSize: 11, color: 'var(--text-3)' }}>{request.diff_id}</span>
          <button
            type="button"
            className="av-hover-control"
            onClick={() => onResolve('reject')}
            style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid var(--border-2)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Reject
          </button>
          <button
            type="button"
            className="av-hover-control"
            onClick={() => onResolve('accept')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 7, border: `1px solid ${accentBorder}`, background: accentBg, color: accentColor, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            <Check size={14} /> Accept changes
          </button>
        </div>
      </div>
    </div>
  )
}
