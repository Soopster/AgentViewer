/** @jsxImportSource @opentui/react */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentProvider } from '../../lib/types'
import type { TuiThemePalette } from '../theme'
import { readTuiCoordinatorResult } from '../../lib/tui/service'
import { coordinatorResultLines, type CoordinatorResultReview as ResultReview } from '../../lib/coordinatorResultReview'
import { MODAL_CONTENT_Z_INDEX } from './layers'
import { runInteractiveCoordinatorAction } from './interactiveCoordinatorStore'

type Key = { name: string; ctrl: boolean; shift: boolean; sequence: string }
export function CoordinatorResultReview({ sessionId, provider, taskId, theme, width, height, onClose, onNotice, onKeyHandlerReady }: {
  sessionId: string; provider: AgentProvider; taskId: string; theme: TuiThemePalette; width: number; height: number
  onNotice: (tone: 'info' | 'error', text: string, durationMs?: number) => void
  onClose: () => void; onKeyHandlerReady: (handler: (key: Key) => void) => void
}) {
  const [review, setReview] = useState<ResultReview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [offset, setOffset] = useState(0)
  const [showDiff, setShowDiff] = useState(false)
  const refresh = useCallback(async () => {
    setBusy(true); setConfirm(false); setError('')
    try { setReview(await readTuiCoordinatorResult(sessionId, provider, taskId)) }
    catch (error) { setReview(null); setError(String(error)) }
    finally { setBusy(false) }
  }, [sessionId, provider, taskId])
  useEffect(() => { void refresh() }, [refresh])
  const innerWidth = Math.max(10, width - 8)
  const rows = Math.max(3, height - 10)
  const lines = useMemo(() => {
    const content = review ? coordinatorResultLines(review) : ['Loading result…']
    if (showDiff && review?.checkout) content.push('TRACKED DIFF (untracked contents must be inspected in the checkout)', review.checkout.diff || 'No tracked diff.', ...(review.checkout.diffTruncated ? ['Diff preview truncated.'] : []))
    return content.flatMap(line => line.split('\n').flatMap(part => part.match(new RegExp(`.{1,${innerWidth}}`, 'gu')) ?? ['']))
  }, [review, showDiff, innerWidth])
  const top = Math.min(offset, Math.max(0, lines.length - rows))
  const handleKey = useCallback((key: Key) => {
    if (key.name === 'escape') { if (confirm) setConfirm(false); else onClose(); return }
    if (busy) return
    if (confirm) {
      if (key.name === 'y' && review?.checkout) {
        setBusy(true)
        void runInteractiveCoordinatorAction({ action: 'integrate-result', taskId, token: review.checkout.token, detail: `Stage reviewed result ${taskId}` }).then((ok) => {
          if (ok) onNotice('info', 'Integration confirmed. Inspect the target checkout; no target commit was created.', 6000)
          // The parent owns journal reconciliation and shows the exact pending request.
          onClose()
        }).finally(() => setBusy(false))
      } else setConfirm(false)
      return
    }
    if (key.name === 'r') { void refresh(); return }
    if (key.name === 'd') { setShowDiff(value => !value); setOffset(0); return }
    if (key.name === 'm' && review?.checkout && !review.integrationBlockers.length) { setConfirm(true); return }
    if (key.name === 'j' || key.name === 'down') setOffset(Math.min(top + 1, Math.max(0, lines.length - rows)))
    if (key.name === 'k' || key.name === 'up') setOffset(Math.max(0, top - 1))
    if (key.name === 'pagedown') setOffset(Math.min(top + rows, Math.max(0, lines.length - rows)))
    if (key.name === 'pageup') setOffset(Math.max(0, top - rows))
  }, [busy, confirm, lines.length, onClose, onNotice, refresh, review, rows, taskId, top])
  useEffect(() => { onKeyHandlerReady(handleKey) }, [handleKey, onKeyHandlerReady])
  return <box position="absolute" top={2} left={2} zIndex={MODAL_CONTENT_Z_INDEX} width={Math.max(20, width - 4)} height={Math.max(12, height - 4)} border borderColor={theme.border} backgroundColor={theme.surface} flexDirection="column" paddingX={1}>
    <text fg={theme.cyan}>RESULT REVIEW · {taskId}</text>
    <box height={rows} flexDirection="column">{lines.slice(top, top + rows).map((line, index) => <text key={index} fg={theme.text} wrapMode="none">{line || ' '}</text>)}</box>
    {error ? <text fg={theme.red} wrapMode="word">{error}</text> : null}
    <text fg={theme.amber} wrapMode="word">{confirm ? 'Commit teammate edits, then squash-stage the ENTIRE branch in the target checkout? y confirm · other key cancel' : busy ? 'Working…' : `${top + 1}-${Math.min(top + rows, lines.length)} / ${lines.length} · j/k scroll · PgUp/PgDn`}</text>
    <text fg={theme.cyan} wrapMode="word">r refresh · d tracked diff{review?.checkout && !review.integrationBlockers.length ? ' · m stage in target…' : ''} · esc back</text>
  </box>
}
