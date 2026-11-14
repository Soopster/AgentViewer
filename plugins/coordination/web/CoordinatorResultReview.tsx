'use client'

import { useEffect, useState } from 'react'
import type { AgentProvider } from '@/lib/types'
import { coordinatorResultLines, type CoordinatorResultReview as ResultReview } from '@/lib/coordinatorResultReview'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

type Submission = { provider: AgentProvider; token: string; requestId: string }
export default function CoordinatorResultReview({ sessionId, provider, taskId }: { sessionId: string; provider: AgentProvider; taskId: string }) {
  const [review, setReview] = useState<ResultReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [pending, setPending] = useState<Submission | null>(null)
  const endpoint = `/api/sessions/${encodeURIComponent(sessionId)}/coordination/results/${encodeURIComponent(taskId)}`
  const journal = `coordinator:integration:${provider}:${sessionId}:${taskId}`
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(journal)
      if (saved) { setPending(JSON.parse(saved)); setNotice('Previous integration is unconfirmed. Inspect the target checkout, then reconcile the same request.') }
    } catch { setError('Could not read the integration journal. Resolve browser storage before integrating.') }
  }, [journal])
  async function refresh() {
    setBusy(true); setError(''); setConfirm(false)
    try {
      const saved = sessionStorage.getItem(journal)
      if (saved) setPending(JSON.parse(saved))
      const response = await fetch(`${endpoint}?provider=${provider}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not read result')
      setReview(data)
    } catch (error) { setReview(null); setError(String(error)) } finally { setBusy(false) }
  }
  async function integrate() {
    if (!pending && !review?.checkout) return
    const body = pending ?? { provider, token: review!.checkout!.token, requestId: crypto.randomUUID() }
    setBusy(true); setError(''); setConfirm(false)
    try {
      const saved = sessionStorage.getItem(journal)
      if (saved && JSON.parse(saved).requestId !== body.requestId) {
        setPending(JSON.parse(saved)); throw new Error('Another integration request is unconfirmed. Reconcile that request first.')
      }
      // Persist before submission. A refresh must not create a second integration.
      sessionStorage.setItem(journal, JSON.stringify(body)); setPending(body)
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Integration unconfirmed')
      sessionStorage.removeItem(journal); setPending(null); setReview(null)
      setNotice(data.staged ? 'Changes staged in the target checkout. Review and commit them there; no target commit was created.' : 'No changes were staged. Inspect the target checkout.')
    } catch (error) { setError(`${String(error)} Inspect the target before retrying or starting a new review.`) } finally { setBusy(false) }
  }
  return <section aria-label="Result review" className="flex flex-col gap-3 py-2">
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>{busy ? 'Loading…' : review ? 'Refresh result review' : 'Review result'}</Button>
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {review ? <>
      <div className="flex flex-col gap-2 text-sm">{coordinatorResultLines(review).map((line, index) => <p className="whitespace-pre-wrap break-words" key={index}>{line}</p>)}</div>
      {review.checkout ? <details><summary>Inspect tracked diff{review.checkout.diffTruncated ? ' (preview truncated)' : ''}</summary><p className="text-sm">Untracked files are listed above; inspect their contents in the checkout.</p><pre className="max-h-80 overflow-auto text-xs">{review.checkout.diff || 'No tracked diff.'}</pre></details> : null}
      {!pending && !review.integrationBlockers.length && review.checkout ? <>
        <Button variant="outline" disabled={busy} onClick={() => setConfirm(true)}>Stage changes in target checkout…</Button>
        {confirm ? <div className="flex flex-col gap-2">
          <p>This commits any uncommitted teammate changes on its branch, then squash-stages the entire branch in {review.checkout.target}. The target commit remains yours to make. {review.verification === 'missing' ? 'No executed checks are recorded.' : ''}</p>
          <div className="flex gap-2"><Button disabled={busy} onClick={() => void integrate()}>Confirm stage changes</Button><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button></div>
        </div> : null}
      </> : null}
    </> : null}
    {pending ? <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void integrate()}>Reconcile same integration request</Button><Button variant="ghost" disabled={busy} onClick={() => { try { sessionStorage.removeItem(journal); setPending(null); setReview(null); setNotice('Request cleared after inspection. Refresh the result before any further integration.') } catch { setError('Could not clear the integration journal.') } }}>Clear request after inspecting target</Button></div> : null}
  </section>
}
