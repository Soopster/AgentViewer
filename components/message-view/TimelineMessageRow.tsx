import { memo, useState, useCallback, useMemo, useSyncExternalStore } from 'react'
import { messageToCopyText } from '@/lib/threadedMessageText'
import MessageItem from '../MessageItem'
import { DEFAULT_COLOR_TREATMENT, getCurrentColorTreatment, subscribeColorTreatment, type ColorTreatment } from '@/lib/colorTreatment'
import { type TimelineRow } from './types'

export const TimelineMessageRow = memo(function TimelineMessageRow({
  row,
  highlighted,
  forking,
  resumeTarget,
  bookmarked,
  streamMode,
  onForkFromMessage,
  onToggleResume,
  onToggleBookmark,
  onReusePrompt,
  onQuoteMessage,
  onReplyMessage,
  onEditFromMessage,
}: {
  row: TimelineRow
  // Per-row interaction state passed as booleans (not baked into the row
  // object) so a highlight/fork/resume change re-renders only the affected
  // rows instead of rebuilding the whole rows array + virtual layout.
  highlighted: boolean
  forking: boolean
  resumeTarget: boolean
  bookmarked: boolean
  streamMode: boolean
  onForkFromMessage: (messageId: string) => void
  onToggleResume: (messageId: string) => void
  onToggleBookmark: (messageId: string) => void
  onReusePrompt: (text: string) => void
  onQuoteMessage: (text: string) => void
  onReplyMessage: (text: string) => void
  onEditFromMessage: (messageId: string, text: string) => void
}) {
  const [copied, setCopied] = useState(false)
  // 'missing' is an ordinary outcome, not an error: raw frames are retained
  // only for recently mapped sessions (see lib/rawFrames.ts).
  const [rawState, setRawState] = useState<'idle' | 'copied' | 'missing' | 'denied'>('idle')
  const copyText = useMemo(() => messageToCopyText(row.message), [row.message])
  const flatTimeline = useSyncExternalStore<ColorTreatment>(subscribeColorTreatment, getCurrentColorTreatment, () => DEFAULT_COLOR_TREATMENT) === 'flat'
  const canCopy = copyText.length > 0
  const isUserMessage = row.message.role === 'user'
  const canReuse = isUserMessage && copyText.length > 0
  const canEdit = isUserMessage && copyText.length > 0 && !!row.allowEdit
  const canQuote = !isUserMessage && copyText.length > 0
  const canReply = copyText.length > 0
  const canBookmark = !row.message.uuid.startsWith('live-')
  // The provider's own frame for this message, when the server still holds it.
  const canCopyRaw = canBookmark && !!row.message.sessionId
  const showActions = canCopy || canReuse || canQuote || canReply || canEdit || canBookmark || canCopyRaw || (row.showForkControls && (row.allowFork || row.allowResume))
  const handleBookmark = useCallback(() => {
    if (!canBookmark) return
    onToggleBookmark(row.message.uuid)
  }, [canBookmark, onToggleBookmark, row.message.uuid])
  const handleCopyRaw = useCallback(() => {
    const sessionId = row.message.sessionId
    if (!canCopyRaw || !sessionId) return
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(row.message.uuid)}/raw`
    void fetch(url)
      .then(async (res) => {
        if (res.status === 404) { setRawState('missing'); return }
        if (!res.ok) { setRawState('denied'); return }
        const frame = await res.json()
        await navigator.clipboard.writeText(JSON.stringify(frame, null, 2))
        setRawState('copied')
      })
      .catch(() => setRawState('denied'))
      .finally(() => { window.setTimeout(() => setRawState('idle'), 1600) })
  }, [canCopyRaw, row.message.sessionId, row.message.uuid])
  const handleCopy = useCallback(() => {
    if (!canCopy) return
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }).catch(() => {})
  }, [canCopy, copyText])
  const handleReuse = useCallback(() => {
    if (!canReuse) return
    onReusePrompt(copyText)
  }, [canReuse, copyText, onReusePrompt])
  const handleQuote = useCallback(() => {
    if (!canQuote) return
    const selection = typeof window !== 'undefined' ? window.getSelection()?.toString().trim() : ''
    onQuoteMessage(selection && selection.length > 0 ? selection : copyText)
  }, [canQuote, copyText, onQuoteMessage])
  const handleReply = useCallback(() => {
    if (!canReply) return
    onReplyMessage(copyText)
  }, [canReply, copyText, onReplyMessage])
  const handleEdit = useCallback(() => {
    if (!canEdit) return
    onEditFromMessage(row.message.uuid, copyText)
  }, [canEdit, copyText, onEditFromMessage, row.message.uuid])

  return (
    <div
      style={{
        position: 'relative',
        opacity: row.dimmed ? 0.92 : 1,
        borderRadius: streamMode ? 6 : 10,
        padding: streamMode ? '8px 12px' : undefined,
        // The cyan ring is the transient nav/target highlight; the amber ring
        // is the persistent bookmark accent. Both use theme-aware colours so
        // bookmarks read correctly on every theme. Highlight wins when both.
        boxShadow: streamMode
          ? flatTimeline
            ? highlighted
              ? '0 0 0 1.5px rgba(56,217,245,0.55)'
              : bookmarked
                ? '0 0 0 1.5px color-mix(in srgb, var(--t-bookmark) 60%, transparent)'
                : 'none'
            : highlighted
              ? '0 0 0 1.5px rgba(56,217,245,0.55)'
              : bookmarked
                ? '0 0 0 1.5px color-mix(in srgb, var(--t-bookmark) 60%, transparent)'
                : 'none'
          : flatTimeline
            ? highlighted
              ? '0 0 0 2px rgba(56,217,245,0.55)'
              : bookmarked
                ? '0 0 0 1.5px color-mix(in srgb, var(--t-bookmark) 60%, transparent)'
                : 'none'
            : highlighted
              ? '0 0 0 2px rgba(56,217,245,0.55), 0 0 36px rgba(56,217,245,0.18)'
              : bookmarked
                ? '0 0 0 1.5px color-mix(in srgb, var(--t-bookmark) 60%, transparent), 0 0 22px color-mix(in srgb, var(--t-bookmark) 14%, transparent)'
                : 'none',
        background: streamMode ? 'transparent' : highlighted
          ? 'rgba(56,217,245,0.06)'
          : bookmarked
            ? 'color-mix(in srgb, var(--t-bookmark) 7%, transparent)'
            : 'transparent',
        // Only transition compositor-friendly properties (box-shadow, background).
        // Animating padding would be layout-affecting and re-trigger the per-row
        // ResizeObserver the virtual scroll relies on for measurement — let
        // padding changes (streamMode toggles) apply instantly instead.
        transition: 'box-shadow 180ms ease, background 180ms ease',
      }}
    >
      {bookmarked && !streamMode && (
        <span
          className="timeline-row-bookmark-flag"
          aria-hidden
          title="Bookmarked"
        >
          ★
        </span>
      )}
      {row.previewBadge && !streamMode && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 8,
          margin: '0 0 8px 0',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          letterSpacing: '0.05em',
        }}>
          {row.activityDetail && (
            <span style={{
              color: 'var(--text-3)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {row.activityDetail}
            </span>
          )}
          <span style={{
            height: 20,
            padding: '0 8px',
            borderRadius: 999,
            border: row.activityTone === 'syncing' ? '1px solid rgba(234,170,64,0.28)' : '1px solid rgba(56,217,245,0.25)',
            background: row.activityTone === 'syncing' ? 'rgba(234,170,64,0.09)' : 'rgba(56,217,245,0.08)',
            color: row.activityTone === 'syncing' ? 'var(--amber, #eaaa40)' : 'var(--cyan)',
            letterSpacing: '0.06em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: row.activityTone === 'syncing' ? 'var(--amber, #eaaa40)' : 'var(--cyan)',
              boxShadow: flatTimeline ? 'none' : row.activityTone === 'syncing' ? '0 0 6px rgba(234,170,64,0.45)' : '0 0 6px var(--cyan-glow)',
              animation: row.activityTone === 'syncing' ? undefined : 'pulse 1.2s ease-in-out infinite',
            }} />
            {row.previewBadge}
          </span>
        </div>
      )}
      {row.liveToolActivities && row.liveToolActivities.length > 0 && !streamMode && (
        <div style={{ margin: '0 0 10px 38px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {row.liveToolActivities.map((activity) => (
            <span
              key={activity.key}
              style={{
                height: 22,
                padding: '0 8px',
                borderRadius: 999,
                border: `1px solid ${activity.status === 'running' ? 'rgba(56,217,245,0.25)' : 'rgba(45,212,160,0.22)'}`,
                background: activity.status === 'running' ? 'rgba(56,217,245,0.08)' : 'rgba(45,212,160,0.08)',
                color: activity.status === 'running' ? 'var(--cyan)' : 'var(--green)',
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.05em',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
              title={activity.detail ?? activity.label}
            >
              <span>{activity.label}</span>
              <span style={{ color: activity.status === 'running' ? 'var(--cyan)' : 'var(--green)' }}>
                {activity.status === 'running' ? 'RUNNING' : 'DONE'}
              </span>
            </span>
          ))}
        </div>
      )}
      {streamMode && row.streamTurnHint !== undefined ? (
        <div className="av-stream-turn-rule">{row.streamTurnHint}</div>
      ) : null}
      {showActions && (
        <div className="timeline-row-actions">
          {canBookmark && (
            <button
              type="button"
              className={`timeline-row-action av-hover-control timeline-row-action--bookmark${bookmarked ? ' timeline-row-action--bookmark-active' : ''}`}
              onClick={handleBookmark}
              title={bookmarked ? 'Remove bookmark' : 'Bookmark this message'}
            >
              {bookmarked ? '★ SAVED' : '☆ BOOKMARK'}
            </button>
          )}
          {row.showForkControls && row.allowFork && (
            <button
              type="button"
              className="timeline-row-action av-hover-control timeline-row-action--fork"
              onClick={() => onForkFromMessage(row.message.providerMessageId ?? row.message.uuid)}
              disabled={forking}
            >
              {forking ? 'FORKING…' : 'FORK HERE'}
            </button>
          )}
          {row.showForkControls && row.allowResume && (
            <button
              type="button"
              className={`timeline-row-action av-hover-control timeline-row-action--resume${resumeTarget ? ' timeline-row-action--resume-active' : ''}`}
              onClick={() => onToggleResume(row.message.uuid)}
            >
              {resumeTarget ? 'RESUME TARGET' : 'RESUME HERE'}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="timeline-row-action av-hover-control timeline-row-action--resume"
              onClick={handleEdit}
              title="Edit this prompt and resend — replaces from this point"
            >
              EDIT
            </button>
          )}
          {canReuse && (
            <button
              type="button"
              className="timeline-row-action av-hover-control timeline-row-action--copy"
              onClick={handleReuse}
              title="Load this prompt into the composer"
            >
              REUSE
            </button>
          )}
          {canQuote && (
            <button
              type="button"
              className="timeline-row-action av-hover-control timeline-row-action--copy"
              onClick={handleQuote}
              title="Quote selection (or this message) in the composer"
            >
              QUOTE
            </button>
          )}
          {canReply && (
            <button
              type="button"
              className="timeline-row-action av-hover-control timeline-row-action--copy"
              onClick={handleReply}
              title="Reply to this message in the composer"
            >
              REPLY
            </button>
          )}
          {canCopy && (
            <button
              type="button"
              className={`timeline-row-action av-hover-control timeline-row-action--copy${copied ? ' timeline-row-action--copy-active' : ''}`}
              onClick={handleCopy}
              title="Copy message text"
            >
              {copied ? 'COPIED' : 'COPY'}
            </button>
          )}
          {canCopyRaw && (
            <button
              type="button"
              className="timeline-row-action av-hover-control timeline-row-action--copy"
              onClick={handleCopyRaw}
              title="Copy the provider's original frame for this message"
            >
              {rawState === 'copied' ? 'COPIED'
                : rawState === 'missing' ? 'NO FRAME'
                  : rawState === 'denied' ? 'DENIED'
                    : 'RAW'}
            </button>
          )}
        </div>
      )}
      <MessageItem message={row.message} showSession={row.showSession} />
      {streamMode && row.streamTurnFooterHint ? (
        <div className="av-stream-turn-footer">{row.streamTurnFooterHint}</div>
      ) : null}
    </div>
  )
})