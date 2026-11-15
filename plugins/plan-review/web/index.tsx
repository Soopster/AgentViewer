'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { WebPluginView, WebPluginViewProps } from '@/components/shell/pluginTypes'
import { PLUGIN_API_VERSION, type PluginViewModule } from '@/lib/plugins/types'
import { latestPlan, planApproved, planNotes, planPendingNotes, planRevisionDiff, PLAN_LABELS, type PlanTarget, type PlanReview } from '@/lib/plugins/planReview'
import { useReviewView, type ReviewViewState } from '../useReviewView'
import { PlanDocument } from './document'

function SourcePicker({ state, service, target }: { state: ReviewViewState; service: NonNullable<WebPluginViewProps['services']['plan-review']>; target?: PlanTarget }) {
  const [file, setFile] = useState(''), [messages, setMessages] = useState<{ id: string; text: string }[]>([]), [messageId, setMessageId] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const request = new AbortController(); controller.current = request
    return () => request.abort()
  }, [service, target?.provider, target?.providerInstanceId, target?.sessionId])
  const load = async () => {
    const request = controller.current
    if (!target || !request) return
    try { const next = await service.messages(target, request.signal); if (request.signal.aborted) return; setMessages(next); setMessageId(next.at(-1)?.id ?? '') } catch (cause) { if (!request.signal.aborted) state.setNotice(String(cause)) }
  }
  return <details className="rounded border p-2"><summary className="cursor-pointer text-sm">Review a message or Markdown file</summary>
    <div className="mt-2 flex flex-wrap gap-2"><label className="flex flex-col text-xs">Markdown path<input className="rounded border bg-background p-2 text-sm" value={file} onChange={event => setFile(event.target.value)} placeholder="docs/plan.md" /></label><Button disabled={state.busy || !file.trim()} variant="outline" size="sm" onClick={() => void state.openFile(file)}>Open file</Button></div>
    <div className="mt-2 flex flex-wrap gap-2"><Button disabled={!target || state.busy} variant="outline" size="sm" onClick={() => void load()}>Load recent messages</Button>{messages.length ? <><select aria-label="Source assistant message" className="min-w-0 max-w-full rounded border bg-background p-1 text-xs" value={messageId} onChange={event => setMessageId(event.target.value)}>{messages.map(message => <option key={message.id} value={message.id}>{message.text.replace(/\s+/g, ' ').slice(0, 100)}</option>)}</select><Button disabled={state.busy} variant="outline" size="sm" onClick={() => void state.openMessage(messageId)}>Review message</Button></> : null}</div>
  </details>
}
function Annotations({ state }: { state: ReviewViewState }) {
  const revision = state.review && latestPlan(state.review), notes = state.review ? planNotes(state.review) : []
  const draft = state.draft
  return <section aria-label="Plan annotations" className="flex min-h-0 flex-col gap-2">
    <h3 className="font-semibold">Annotations · {notes.length}</h3>
    <label className="text-xs">Annotation type<select className="ml-2 rounded border bg-background p-1" value={draft.kind} onChange={event => state.setDraft({ ...draft, kind: event.target.value as typeof draft.kind })}><option value="comment">Comment</option><option value="deletion">Remove selection</option><option value="global">General comment</option><option value="label">Quick label</option></select></label>
    {draft.kind !== 'global' ? <blockquote aria-label="Selected passage" className="max-h-36 overflow-auto border-l-2 pl-2 text-xs">{revision?.text.slice(draft.start, draft.end) || 'Select plan text or a line range.'}</blockquote> : null}
    {draft.kind === 'label' ? <select aria-label="Quick label" className="rounded border bg-background p-2 text-sm" value={draft.text} onChange={event => state.setDraft({ ...draft, text: event.target.value })}><option value="">Choose a label</option>{PLAN_LABELS.map(label => <option key={label}>{label}</option>)}</select> : <label className="text-xs">Review comment<Textarea aria-label="Review comment" value={draft.text} onChange={event => state.setDraft({ ...draft, text: event.target.value })} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void state.annotate() } }} placeholder="What should change, and why?" /></label>}
    <div className="flex flex-wrap gap-2">{state.notice.includes('Draft changed') ? <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.retryDraft()}>Replace refreshed draft with mine</Button> : null}<Button size="sm" disabled={state.busy || !revision} onClick={() => void state.annotate()}>Save annotation</Button><Button size="sm" variant="ghost" disabled={state.busy} onClick={() => void state.discard()}>Discard draft</Button></div>
    <div className="min-h-0 overflow-auto">{notes.map(note => <article key={note.id} className="my-2 rounded border p-2 text-sm">
      <p className="text-xs text-muted-foreground">{note.kind}{note.resolved ? ' · resolved' : ''}{note.anchor ? note.anchor.status === 'active' ? ` · line ${note.anchor.line}` : ' · selection no longer matched' : ''}</p>
      {note.anchor ? <blockquote className="my-1 whitespace-pre-wrap border-l-2 pl-2 text-xs">{note.anchor.quote}</blockquote> : null}<p className="whitespace-pre-wrap">{note.text || 'Remove this passage.'}</p>
      <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.resolve(note.id, !note.resolved)}>{note.resolved ? 'Reopen annotation' : 'Resolve annotation'}</Button>
      <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => void state.remove(note.id)}>Delete annotation</Button>
    </article>)}</div>
  </section>
}
function Decisions({ state }: { state: ReviewViewState }) {
  const [mode, setMode] = useState<'default' | 'acceptEdits'>('default')
  if (!state.review) return null
  const review = state.review, revision = latestPlan(review), native = revision.source.kind === 'native'
  const receipt = review.deliveries.filter(item => item.revision === revision.hash).at(-1)
  return <footer className="flex flex-col gap-2 border-t pt-3">
    <div className="flex flex-wrap items-center gap-2"><Button disabled={state.busy || !planPendingNotes(review).length} variant="outline" size="sm" onClick={() => void state.send('feedback')}>Request changes</Button>
      <Button disabled={state.busy || planApproved(review)} variant="outline" size="sm" onClick={() => void state.approve()}>{planApproved(review) ? 'Approved' : 'Approve'}</Button>
      {native ? <label className="text-xs">Implementation permissions <select aria-label="Implementation permissions" className="rounded border bg-background p-1" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="default">Ask before edits</option><option value="acceptEdits">Accept edits</option></select></label> : null}
      <Button disabled={state.busy || !planApproved(review)} size="sm" onClick={() => void state.send('implement', mode)}>Implement approved plan</Button>
    </div>
    <p className="text-xs text-muted-foreground">Approval records your decision. Implement sends it to {revision.source.target.provider} · {revision.source.target.providerInstanceId ?? 'default'} · {revision.source.target.sessionId}.</p>
    {native && planPendingNotes(review).length ? <p className="text-xs">Resolve addressed notes, or request changes so the native plan includes them before implementation.</p> : null}
    {receipt && (receipt.status === 'pending' || receipt.status === 'unknown') ? <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void state.reconcile()}>Check delivery receipt</Button> : null}
    {receipt ? <p role="status" className="text-xs">{receipt.action} · {receipt.status}{receipt.error ? ` · ${receipt.error}` : ''}{receipt.status === 'pending' || receipt.status === 'unknown' ? ' · Inspect the source session before resending.' : ''}</p> : null}
  </footer>
}
function RevisionHistory({ review }: { review: PlanReview }) {
  const [index, setIndex] = useState(-1)
  const selected = Math.min(index < 0 ? review.revisions.length - 1 : index, review.revisions.length - 1)
  const revision = review.revisions[selected], previous = review.revisions[selected - 1]
  return <details className="rounded border p-2"><summary className="cursor-pointer text-sm">Revision history · {review.revisions.length}</summary>
    <select aria-label="Plan revision" className="my-2 rounded border bg-background p-1 text-xs" value={selected} onChange={event => setIndex(Number(event.target.value))}>{review.revisions.map((item, i) => <option key={`${item.hash}:${i}`} value={i}>Revision {i + 1} · {new Date(item.createdAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'} · {review.decisions.filter(decision => decision.revision === item.hash).at(-1)?.kind === 'approved' ? 'approved' : 'unapproved'}</option>)}</select>
    {review.drafts[`editor:${revision.hash}`] ? <blockquote className="my-2 whitespace-pre-wrap border-l-2 pl-2 text-sm">Draft from this revision: {review.drafts[`editor:${revision.hash}`].text || revision.text.slice(review.drafts[`editor:${revision.hash}`].start, review.drafts[`editor:${revision.hash}`].end)}</blockquote> : null}
    <pre aria-label="Plan revision comparison" className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs">{previous ? planRevisionDiff(previous.text, revision.text) : revision.text}</pre>
  </details>
}
function PlanReviewView({ services, placement, close, useState: scoped }: WebPluginViewProps) {
  const session = services.session?.session
  const target: PlanTarget | undefined = session?.provider ? { provider: session.provider, providerInstanceId: session.providerInstanceId, sessionId: session.sessionId } : undefined
  const service = services['plan-review']!, state = useReviewView(service, services.repository!.cwd, target, scoped)
  const review = state.review, revision = review && latestPlan(review)
  const notes = useMemo(() => review ? planNotes(review) : [], [review])
  useEffect(() => {
    if (placement !== 'overlay') return
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) close() }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [placement, close])
  const body = <section data-plugin-view="plan-review" aria-label="Plan Review" className="flex h-full min-h-0 flex-col gap-3 overflow-auto bg-background p-4 text-foreground">
    <style>{`.plan-review-document h1,.plan-review-document h2,.plan-review-document h3{font-weight:600;margin:1em 0 .5em}.plan-review-document h1{font-size:1.4em}.plan-review-document h2{font-size:1.2em}.plan-review-document p{margin:.5em 0}.plan-review-document ul,.plan-review-document ol{padding-left:1.5em;list-style:revert}.plan-review-document pre{white-space:pre-wrap}.plan-review-document code{font-family:var(--font-mono,monospace)}.plan-review-document mark{background:var(--amber,#f5c451);color:#111}`}</style>
    <header className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Plan Review</h2><Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.refresh()}>Refresh plans</Button>{placement === 'overlay' ? <Button variant="ghost" size="sm" onClick={close}>Close</Button> : null}</header>
    {state.notice || state.error ? <p role="status" className="text-sm">{state.notice || state.error}</p> : null}
    <SourcePicker key={`${target?.provider}:${target?.providerInstanceId}:${target?.sessionId}`} state={state} service={service} target={target} />
    {state.snapshot?.reviews.length ? <label className="text-xs">Review<select aria-label="Plan to review" className="ml-2 max-w-full rounded border bg-background p-1" value={review?.id ?? ''} onChange={event => void state.choose(event.target.value)}>{state.snapshot.reviews.map(item => <option key={item.id} value={item.id}>{item.title} · {latestPlan(item).source.target.provider} · {planApproved(item) ? 'approved' : 'needs review'}</option>)}</select></label> : <p>No explicit plan found yet. Review a message or Markdown file, or let an agent finish planning.</p>}
    {review && revision ? <><p className="break-all text-xs text-muted-foreground">{revision.source.path ?? revision.source.messageId ?? revision.source.permissionId} · Revision {review.revisions.length} · {revision.hash.slice(0, 12)}</p>
      <RevisionHistory key={review.id} review={review} />
      <div className="grid min-h-64 flex-1 grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4"><PlanDocument key={revision.hash} text={revision.text} notes={notes} onSelect={state.selectRange} /><Annotations state={state} /></div>
      <Decisions state={state} /></> : null}
  </section>
  if (placement !== 'overlay') return body
  return <div role="dialog" aria-modal="true" aria-label="Plan Review" className="fixed inset-0 z-50 grid place-items-center bg-black/40"><div className="h-[min(900px,94vh)] w-[min(1200px,96vw)] overflow-hidden rounded-lg border shadow-xl">{body}</div></div>
}
export const module: PluginViewModule<WebPluginView> = { apiVersion: PLUGIN_API_VERSION, pluginId: 'plan-review', views: { 'plan-review': PlanReviewView } }
