import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { latestPlan, PLAN_LABELS, type PlanDraft, type PlanOperation, type PlanReviewService, type PlanTarget, type PlanReview } from '../../lib/plugins/planReview'
import { usePlanReviews } from '../../lib/plugins/usePlanReview'
type ScopedState = <T>(name: string, initial: T) => [T, (next: T | ((previous: T) => T)) => void]
const EMPTY_DRAFT: PlanDraft = { text: '', start: 0, end: 0, kind: 'global' }
export function useReviewView(service: PlanReviewService, cwd: string, target: PlanTarget | undefined, scoped: ScopedState) {
  const data = usePlanReviews(service, cwd, target)
  const useViewState = scoped
  const [selectedId, setSelectedId] = useViewState<string | null>('review', null)
  const lifetime = useMemo(() => ({ alive: true }), [cwd, service, target?.provider, target?.providerInstanceId, target?.sessionId])
  const [notice, setNotice] = useState('')
  const [activity, setActivity] = useState<{ owner: object } | null>(null)
  const busy = activity?.owner === lifetime
  const review = data.snapshot?.reviews.find(item => item.id === selectedId)
    ?? data.snapshot?.reviews.find(item => { const source = latestPlan(item).source.target; return source.provider === target?.provider && source.sessionId === target?.sessionId && (source.providerInstanceId ?? source.provider) === (target?.providerInstanceId ?? target?.provider) })
    ?? data.snapshot?.reviews[0]
  const current = useRef(review)
  useLayoutEffect(() => { current.current = review }, [review])
  const [draftValue, setDraftValue] = useState<{ key: string; value: PlanDraft } | null>(null)
  const draftKey = review ? `${review.id}:${latestPlan(review).hash}` : ''
  const draft = draftValue?.key === draftKey ? draftValue.value : (review ? review.drafts[`editor:${latestPlan(review).hash}`] : undefined) ?? EMPTY_DRAFT
  const latestDraft = useRef(draft)
  useLayoutEffect(() => { latestDraft.current = draft }, [draft])
  const dirty = useRef<{ key: string; value: PlanDraft; base: PlanReview } | null>(null)
  const actionLock = useRef<object | null>(null)
  const queue = useRef<Promise<unknown> | null>(null)
  useEffect(() => { lifetime.alive = true; return () => { lifetime.alive = false } }, [lifetime])
  const update = data.update
  const mutateReview = useCallback(async (captured: PlanReview, operation: PlanOperation) => {
    const next = await service.mutate(cwd, { reviewId: captured.id, revision: latestPlan(captured).hash, sequence: captured.sequence, requestId: crypto.randomUUID(), operation: operation.type === 'draft' ? { ...operation, expectedVersion: captured.draftVersions?.[operation.owner] ?? 0 } : operation })
    if (lifetime.alive) { if (current.current?.id === next.id && current.current.sequence <= next.sequence) current.current = next; update(next) }
    return next
  }, [service, cwd, update, lifetime])
  const flush = useCallback(() => {
    queue.current = (queue.current ?? Promise.resolve()).catch(() => {}).then(async () => {
      const pending = dirty.current
      if (!pending) return
      const captured = pending.base
      dirty.current = null
      try {
        const next = await mutateReview(captured, { type: 'draft', owner: `editor:${latestPlan(captured).hash}`, draft: pending.value })
        if (latestPlan(next).hash !== latestPlan(captured).hash && lifetime.alive) setNotice('The plan changed. Your draft is saved with its original revision in Revision history.')
        const newer = dirty.current as { key: string; value: PlanDraft; base: PlanReview } | null
        if (newer?.key === pending.key && newer.base.sequence === captured.sequence) newer.base = next
      }
      catch (error) { if (!dirty.current) dirty.current = pending; throw error }
    })
    return queue.current
  }, [mutateReview])
  useEffect(() => {
    if (!draftValue || draftValue.key !== draftKey) return
    const timer = setTimeout(() => { void flush().catch(cause => { if (lifetime.alive) setNotice(String(cause)) }) }, 500)
    return () => clearTimeout(timer)
  }, [draftValue, draftKey, flush, lifetime])
  // Capture the owning review so relocation/close flushes without following a later selection.
  useEffect(() => () => { void flush().catch(() => {}) }, [flush, draftKey])
  const setDraft = useCallback((next: PlanDraft) => {
    if (!review) return
    const value = { key: draftKey, value: next, base: dirty.current?.key === draftKey ? dirty.current.base : current.current ?? review }; dirty.current = value; setDraftValue(value)
  }, [draftKey, review])
  const beginSelection = useCallback((kind: PlanDraft['kind'], start: number, end: number) => {
    const value = latestDraft.current
    if (value.text.trim() && (value.start !== start || value.end !== end || value.kind !== kind)) {
      setNotice('Save or discard the current annotation before selecting another passage.'); return false
    }
    setDraft({ ...value, kind, start, end, text: kind === 'deletion' ? '' : kind === 'label' ? PLAN_LABELS[0] : value.text })
    return true
  }, [setDraft])
  const selectRange = useCallback((start: number, end: number) => { beginSelection(latestDraft.current.kind === 'global' ? 'comment' : latestDraft.current.kind, start, end) }, [beginSelection])
  const action = async (run: () => Promise<void>) => {
    if (actionLock.current === lifetime) return false
    actionLock.current = lifetime
    setActivity({ owner: lifetime }); setNotice('')
    try { await flush(); if (!lifetime.alive) return false; await run(); return true }
    catch (cause) { if (lifetime.alive) { setNotice(cause instanceof Error ? cause.message : String(cause)); await data.refresh() }; return false }
    finally {
      if (actionLock.current === lifetime) actionLock.current = null
      setActivity(previous => previous?.owner === lifetime ? null : previous)
    }
  }
  const annotate = () => action(async () => {
    const captured = current.current
    if (!captured) return
    if (`${captured.id}:${latestPlan(captured).hash}` !== draftKey) throw new Error('The plan changed. Inspect the new revision before annotating it.')
    let next = await mutateReview(captured, { type: 'annotate', id: crypto.randomUUID(), kind: draft.kind, text: draft.text, ...(draft.kind === 'global' ? {} : { start: draft.start, end: draft.end }) })
    next = await mutateReview(next, { type: 'draft', owner: `editor:${latestPlan(next).hash}`, draft: null })
    dirty.current = null; setDraftValue({ key: draftKey, value: EMPTY_DRAFT })
  })
  const approve = () => action(async () => { if (current.current) await mutateReview(current.current, { type: 'approve' }) })
  const resolve = (id: string, resolved: boolean) => action(async () => { if (current.current) await mutateReview(current.current, { type: 'resolve', id, resolved }) })
  const remove = (id: string) => action(async () => { if (current.current) await mutateReview(current.current, { type: 'delete', id }) })
  const send = (mode: 'feedback' | 'implement', permissionMode: 'default' | 'acceptEdits' = 'default') => action(async () => {
    const captured = current.current
    if (!captured) return
    const savedDraft = captured.drafts[`editor:${latestPlan(captured).hash}`]
    if (dirty.current || savedDraft?.text.trim() || (savedDraft && savedDraft.end > savedDraft.start)) throw new Error('Save or discard the annotation draft before sending')
    const next = await service.send(cwd, { reviewId: captured.id, revision: latestPlan(captured).hash, sequence: captured.sequence, requestId: crypto.randomUUID(), action: mode, permissionMode })
    if (lifetime.alive) { current.current = next; update(next); setNotice(next.deliveries.at(-1)?.status === 'sent' ? 'Decision delivered to the source session.' : 'Delivery needs attention. Inspect its receipt before retrying.') }
  })
  const openFile = (file: string) => action(async () => {
    if (!target) throw new Error('Select a destination session first')
    const next = await service.open(cwd, { source: { kind: 'file', path: file, target } })
    if (lifetime.alive) { update(next); setSelectedId(next.id) }
  })
  const openMessage = (messageId: string) => action(async () => {
    if (!target) throw new Error('Select a source session first')
    const next = await service.open(cwd, { source: { kind: 'message', messageId, target } })
    if (lifetime.alive) { update(next); setSelectedId(next.id) }
  })
  const choose = (id: string) => action(async () => { if (lifetime.alive) setSelectedId(id) })
  const reconcile = () => action(async () => {
    const captured = current.current, receipt = captured?.deliveries.at(-1)
    if (captured && receipt) update(await service.reconcile(cwd, captured.id, receipt.id))
  })
  const retryDraft = () => {
    const pending = dirty.current, captured = current.current
    if (!pending || !captured || pending.key !== `${captured.id}:${latestPlan(captured).hash}`) { setNotice('Inspect the draft in its original revision history.'); return Promise.resolve(false) }
    pending.base = captured
    return action(async () => { setNotice('Draft saved after explicitly replacing the refreshed draft.') })
  }
  const discard = () => {
    dirty.current = null
    return action(async () => {
    if (current.current) await mutateReview(current.current, { type: 'draft', owner: `editor:${latestPlan(current.current).hash}`, draft: null })
    dirty.current = null; setDraftValue({ key: draftKey, value: EMPTY_DRAFT })
    })
  }
  return { ...data, review, draft, setDraft, beginSelection, selectRange, notice, setNotice, busy, annotate, approve, remove, resolve, send, openFile, openMessage, choose, discard, reconcile, retryDraft }
}
export type ReviewViewState = ReturnType<typeof useReviewView>
