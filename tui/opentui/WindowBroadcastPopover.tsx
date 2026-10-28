/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScrollBoxRenderable, TextareaRenderable } from '@opentui/core'
import type { Session } from '../../lib/types'
import type { TuiThemePalette } from '../theme'
import { MODAL_CONTENT_Z_INDEX } from './layers'
import { formatSessionTitle } from '../format'
import { fitText } from './textLayout'
import { snapshotBroadcastTargets, type WindowTarget } from './windowTargets'
import { deliverWindowBroadcast, validateBroadcast, type BroadcastDelivery, type BroadcastResult } from './windowBroadcast'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }
type Review = { sessions: Session[]; text: string }

export function WindowBroadcastPopover({ targets, theme, width, height, onSend, onClose, onKeyHandlerReady }: {
  targets: WindowTarget[]; theme: TuiThemePalette; width: number; height: number
  onSend: (session: Session, text: string, requestId: string) => Promise<BroadcastDelivery>
  onClose: () => void; onKeyHandlerReady: (handler: (key: Key) => boolean) => void
}) {
  const [phase, setPhase] = useState<'targets' | 'compose' | 'review' | 'sending' | 'results'>('targets')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [cursor, setCursor] = useState(0)
  const cursorRef = useRef(0)
  const selectedRef = useRef(selected)
  const draftRef = useRef('')
  const [draft, setDraft] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [results, setResults] = useState<BroadcastResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const editor = useRef<TextareaRenderable | null>(null)
  const submitting = useRef(false)
  const reviewScroll = useRef<ScrollBoxRenderable | null>(null)
  const sessions = useMemo(() => snapshotBroadcastTargets(targets, selected), [targets, selected])
  const index = Math.min(cursor, Math.max(0, targets.length - 1))
  cursorRef.current = index
  const toggle = useCallback((target: WindowTarget) => {
    if (target.session?.isPending || !target.session) return
    const next = new Set(selectedRef.current)
    if (next.has(target.key)) next.delete(target.key)
    else next.add(target.key)
    selectedRef.current = next
    setSelected(next)
    setError(null)
  }, [])
  const prepare = useCallback(() => {
    const text = draftRef.current
    const captured = snapshotBroadcastTargets(targets, selectedRef.current)
    const error = validateBroadcast(text, captured)
    setError(error)
    if (error) return
    setReview({ sessions: captured, text: text.trim() })
    setPhase('review')
  }, [targets])
  const submit = useCallback(async () => {
    if (!review || submitting.current) return
    submitting.current = true
    setPhase('sending')
    setResults([])
    try {
      await deliverWindowBroadcast(review.sessions, review.text, onSend, (result) => {
        setResults((previous) => [...previous, result])
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Broadcast could not be submitted')
    } finally {
      submitting.current = false
      setPhase('results')
    }
  }, [onSend, review])
  const handleKey = useCallback((key: Key) => {
    if ((phase === 'review' || phase === 'results' || phase === 'sending') && ['up', 'down', 'pageup', 'pagedown'].includes(key.name)) {
      reviewScroll.current?.scrollBy(key.name === 'up' ? -1 : key.name === 'down' ? 1 : key.name === 'pageup' ? -8 : 8)
      return true
    }
    if (phase === 'sending') return true
    if (key.name === 'escape') {
      if (phase === 'review') setPhase('compose')
      else onClose()
      return true
    }
    if (phase === 'results') { if (key.name === 'return') onClose(); return true }
    if (phase === 'review') {
      if (key.name === 'return') void submit()
      else if (key.name === 'tab') setPhase('targets')
      return true
    }
    if (phase === 'compose') {
      if (key.name === 'tab') { setPhase('targets'); return true }
      if (key.ctrl && key.name === 'return') { prepare(); return true }
      return false
    }
    if (key.name === 'down' || key.sequence === 'j') { cursorRef.current = Math.min(cursorRef.current + 1, Math.max(0, targets.length - 1)); setCursor(cursorRef.current); return true }
    if (key.name === 'up' || key.sequence === 'k') { cursorRef.current = Math.max(cursorRef.current - 1, 0); setCursor(cursorRef.current); return true }
    if (key.name === 'space' || key.sequence === ' ') { if (targets[cursorRef.current]) toggle(targets[cursorRef.current]!); return true }
    if (key.name === 'return' || key.name === 'tab') { setPhase('compose'); return true }
    return true
  }, [index, onClose, phase, prepare, submit, targets, toggle])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])
  const popW = Math.max(24, Math.min(width - 2, 100))
  const popH = Math.max(12, Math.min(height - 2, 34))
  const pageSize = Math.max(1, Math.floor((popH - 12) / 2))
  const start = Math.floor(index / pageSize) * pageSize
  const reviewing = phase === 'review' || phase === 'sending' || phase === 'results'
  return (
    <box id="window-broadcast" position="absolute" left={Math.max(0, Math.floor((width - popW) / 2))} top={Math.max(0, Math.floor((height - popH) / 2))}
      width={popW} height={popH} border borderStyle="rounded" borderColor={theme.cyan} backgroundColor={theme.surface}
      zIndex={MODAL_CONTENT_Z_INDEX} paddingX={1} flexDirection="column">
      <text fg={theme.cyan} wrapMode="none">{reviewing ? `Broadcast to ${review?.sessions.length ?? 0} session windows` : 'Broadcast input · choose session windows'}</text>
      {reviewing ? (
        <scrollbox ref={reviewScroll} id="window-broadcast:review" flexGrow={1} scrollY>
          <box flexDirection="column">
            {review?.sessions.map((session) => {
              const key = `${session.provider ?? 'claude'}:${session.sessionId}`
              const result = results.find((entry) => entry.key === key)
              return <text key={key} fg={result?.status === 'sent' ? theme.green : result ? theme.amber : theme.text} wrapMode="word">
                {`${formatSessionTitle(session)} · ${session.provider ?? 'claude'} · ${session.cwd ?? 'no project'}\n  ${result ? `${result.status}: ${result.detail}` : phase === 'sending' ? 'Sending…' : 'Selected'}`}
              </text>
            })}
            <text fg={theme.dim}>{'\nPrompt:'}</text>
            <text fg={theme.text} wrapMode="word">{review?.text}</text>
            {results.some((result) => result.status === 'unknown') ? <text fg={theme.amber} wrapMode="word">Inspect sessions with unconfirmed delivery before sending again.</text> : null}
          </box>
        </scrollbox>
      ) : (
        <>
          <box flexGrow={1} flexDirection="column" overflow="hidden">
            {targets.length === 0 ? <text fg={theme.dim}>Open session windows to broadcast to them.</text> : targets.slice(start, start + pageSize).map((target, offset) => (
              <box key={target.key} id={`window-broadcast:target:${target.key}`} height={2} flexShrink={0} flexDirection="column"
                backgroundColor={phase === 'targets' && index === start + offset ? theme.surface3 : undefined}
                onMouseDown={(event) => { if (event.button === 0) { event.stopPropagation(); cursorRef.current = start + offset; setCursor(cursorRef.current); toggle(target) } }}>
                <text fg={target.session?.isPending ? theme.dim : selected.has(target.key) ? theme.cyan : theme.text} wrapMode="none">
                  {fitText(`${selected.has(target.key) ? '[x]' : '[ ]'} ${target.title}${target.session?.isPending ? ' · start this session first' : ''}`, popW - 4)}
                </text>
                <text fg={theme.dim} wrapMode="none">{fitText(`    ${target.detail}`, popW - 4)}</text>
              </box>
            ))}
          </box>
          <text fg={theme.cyan} wrapMode="none">{`${sessions.length} selected · tab switches targets/prompt`}</text>
          <box height={6} flexShrink={0} border borderColor={phase === 'compose' ? theme.cyan : theme.border}>
            <textarea id="window-broadcast:prompt" ref={editor} focused={phase === 'compose'} initialValue={draft}
              placeholder="Write one prompt for the selected sessions…" width="100%" height="100%"
              onContentChange={() => { draftRef.current = editor.current?.plainText ?? ''; setDraft(draftRef.current); setError(null) }} />
          </box>
        </>
      )}
      {error ? <text fg={theme.red} wrapMode="word">{error}</text> : null}
      <box id="window-broadcast:action" height={1} flexShrink={0} onMouseDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        if (phase === 'review') void submit()
        else if (phase === 'results') onClose()
        else if (phase !== 'sending') prepare()
      }}>
        <text fg={theme.cyan} wrapMode="none">{phase === 'review' ? 'Enter sends to the listed targets · esc edits · tab changes targets'
          : phase === 'sending' ? 'Waiting for delivery receipts…'
          : phase === 'results' ? 'Enter closes · broadcasts are never retried automatically'
          : 'Space selects · enter edits · Ctrl+Enter reviews · esc closes'}</text>
      </box>
    </box>
  )
}
