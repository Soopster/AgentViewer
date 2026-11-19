import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { emptyReview, reviewRangeKey, type ReviewNote, type ReviewOperation, type ReviewRequest, type ReviewSnapshot, type ReviewReply } from './types'

export type ReviewTransport = { read(cwd: string, source: string, after?: number): Promise<ReviewSnapshot | null>; mutate(request: ReviewRequest): Promise<ReviewSnapshot> }
export type InlineReviewNote = Pick<ReviewNote, 'filePath' | 'range' | 'text'> & Omit<Partial<ReviewNote>, 'replies'> & { replies?: Array<Omit<ReviewReply, 'author'> & { author?: ReviewReply['author'] }> }

/** Serialize this view's writes and discard late responses from a different comparison. */
export function useReview(transport: ReviewTransport, cwd: string, source: string, surface: string, patch: string | undefined, enabled = true, refreshKey?: string) {
  const [viewId] = useState(() => crypto.randomUUID())
  const scope = JSON.stringify([cwd, source])
  const [result, setResult] = useState({ scope, snapshot: emptyReview(source) })
  const [error, setError] = useState<string | null>(null)
  const currentScope = useRef(scope)
  currentScope.current = scope
  const state = result.scope === scope ? result.snapshot : emptyReview(source)
  const latest = useRef(state)
  latest.current = state
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const accept = useCallback((snapshot: ReviewSnapshot) => {
    if (currentScope.current !== scope) return
    setResult(previous => previous.scope === scope && previous.snapshot.sequence >= snapshot.sequence ? previous : { scope, snapshot })
  }, [scope])
  const publish = useCallback((request: Omit<ReviewRequest, 'cwd' | 'source' | 'requestId'>) => {
    const requestId = crypto.randomUUID()
    const pending = queue.current.catch(() => {}).then(() => transport.mutate({ ...request, cwd, source, requestId }))
    queue.current = pending
    void pending.then(snapshot => { accept(snapshot); if (currentScope.current === scope) setError(null) }, reason => {
      if (currentScope.current === scope) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return pending
  }, [accept, cwd, scope, source, transport])
  const mutate = useCallback((operation: ReviewOperation) => publish({ operation }), [publish])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let busy = false
    const poll = async () => {
      if (busy) return
      busy = true
      try { const snapshot = await transport.read(cwd, source, latest.current.sequence || undefined); if (!cancelled && snapshot) accept(snapshot) }
      catch (reason) { if (!cancelled) setError(String(reason)) }
      finally { busy = false }
    }
    void poll()
    const timer = setInterval(() => { void poll() }, 1000)
    const heartbeat = setInterval(() => { void publish({ publish: { viewId, surface } }).catch(() => {}) }, 5000)
    return () => {
      cancelled = true; clearInterval(timer); clearInterval(heartbeat)
      void publish({ publish: { viewId, surface, close: true } }).catch(() => {})
    }
  }, [accept, cwd, enabled, publish, source, surface, transport, viewId])
  useEffect(() => {
    if (!enabled || (patch === undefined && refreshKey === undefined)) return
    void publish({ publish: { patch, refresh: patch === undefined, viewId, surface } }).catch(() => {})
  }, [enabled, patch, publish, refreshKey, surface, viewId])

  const notes = useMemo(() => new Map(state.notes.filter(note => note.resolution === 'active').map(note => [reviewRangeKey(note.filePath, note.range), note])), [state.notes])
  const setNotes = useCallback((update: (previous: Map<string, InlineReviewNote>) => Map<string, InlineReviewNote>) => {
    const before = new Map(latest.current.notes.filter(note => note.resolution === 'active').map(note => [reviewRangeKey(note.filePath, note.range), note]))
    const after = update(before)
    for (const [key, previous] of before) {
      if (!after.has(key)) { void mutate({ type: 'delete', noteId: previous.id, expectedVersion: previous.version }).catch(() => {}); continue }
    }
    for (const [key, note] of after) {
      const previous = before.get(key)
      if (previous?.author === 'agent' && note.text !== previous.text) {
        void mutate({ type: 'reply', noteId: previous.id, text: note.text, author: 'user' }).catch(() => {})
      } else if (!previous || note.text !== previous.text) {
        void mutate({ type: 'note', revision: latest.current.document.revision, id: previous?.id, expectedVersion: previous?.version, filePath: note.filePath, range: note.range, text: note.text, author: 'user' }).catch(() => {})
      } else if (note.resolved !== undefined && note.resolved !== previous.resolved) {
        void mutate({ type: 'resolve', noteId: previous.id, resolved: note.resolved, expectedVersion: previous.version }).catch(() => {})
      }
      for (const reply of note.replies ?? []) if (!previous?.replies.some(item => item.id === reply.id)) {
        void mutate({ type: 'reply', noteId: previous!.id, text: reply.text, author: 'user' }).catch(() => {})
      }
    }
  }, [mutate])
  const navigation = state.views.find(view => view.id === viewId)?.navigation
  return { state, notes, setNotes, mutate, error, viewId, navigation }
}

export type ReviewController = ReturnType<typeof useReview>
