import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProviderSelection, Session, SessionMessage } from '@/lib/types'
import { MESSAGE_POLL_BACKFILL } from './messageStream'
import { mergeMessages, messageTimestampMs, trimProjectMessagesForMemory } from './messageMerge'
import { fetchProjectTranscript, type ProjectMessageBatch, type ProjectTranscriptQuery } from './transcriptApi'

type ProjectTranscriptOptions = {
  dir: string | null
  provider: ProviderSelection
  providerInstanceId: string
  includeWorktrees: boolean
  visible: boolean
  onSessions: (dir: string, sessions: Session[]) => void
}

function updateCounts(counts: Map<string, number>, batches: ProjectMessageBatch[]) {
  for (const batch of batches) {
    counts.set(batch.key, Math.max(counts.get(batch.key) ?? 0, batch.offset + batch.messages.length))
  }
}

export function useProjectTranscript({
  dir, provider, providerInstanceId, includeWorktrees, visible, onSessions,
}: ProjectTranscriptOptions) {
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [loading, setLoading] = useState(false)
  const countsRef = useRef(new Map<string, number>())
  const generationRef = useRef(0)
  const loadAbortRef = useRef<AbortController | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)

  const clear = useCallback(() => {
    generationRef.current++
    loadAbortRef.current?.abort()
    loadAbortRef.current = null
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
    countsRef.current = new Map()
    setMessages([])
    setLoading(false)
  }, [])
  useEffect(() => () => {
    generationRef.current++
    loadAbortRef.current?.abort()
    loadAbortRef.current = null
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
  }, [])

  const load = useCallback(async (projectDir: string): Promise<Session[] | null> => {
    clear()
    const generation = generationRef.current
    const abort = new AbortController()
    loadAbortRef.current = abort
    setLoading(true)
    try {
      const result = await fetchProjectTranscript({ dir: projectDir, provider, providerInstanceId, includeWorktrees }, {}, abort.signal)
      if (abort.signal.aborted || generation !== generationRef.current) return null
      updateCounts(countsRef.current, result.batches)
      const all = result.batches.flatMap(batch => batch.messages)
      all.sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b))
      setMessages(trimProjectMessagesForMemory(all))
      return result.sessions
    } catch (error) {
      if (!abort.signal.aborted) console.error('Failed to load project messages:', error)
      return null
    } finally {
      if (loadAbortRef.current === abort) {
        loadAbortRef.current = null
        // eslint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- inside finally; the ownership guard prevents an old request from clearing a newer load
        setLoading(false)
      }
    }
  }, [clear, provider, providerInstanceId, includeWorktrees])

  useEffect(() => {
    if (!dir || !visible || loading) return
    const generation = generationRef.current
    const query: ProjectTranscriptQuery = { dir, provider, providerInstanceId, includeWorktrees }
    const abort = new AbortController()
    pollAbortRef.current = abort
    let inFlight = false
    const timer = window.setInterval(async () => {
      if (inFlight || abort.signal.aborted || generation !== generationRef.current) return
      inFlight = true
      try {
        const offsets = Object.fromEntries(Array.from(countsRef.current, ([key, count]) => [key, Math.max(0, count - MESSAGE_POLL_BACKFILL)]))
        const result = await fetchProjectTranscript(query, offsets, abort.signal)
        if (abort.signal.aborted || generation !== generationRef.current) return
        updateCounts(countsRef.current, result.batches)
        const incoming = result.batches.flatMap(batch => batch.messages)
        if (incoming.length) setMessages(previous => trimProjectMessagesForMemory(mergeMessages(previous, incoming)))
        onSessions(dir, result.sessions)
      } catch { /* ignore transient polling errors */ }
      finally { inFlight = false }
    }, 2000)
    return () => {
      abort.abort()
      if (pollAbortRef.current === abort) pollAbortRef.current = null
      window.clearInterval(timer)
    }
  }, [dir, provider, providerInstanceId, includeWorktrees, visible, loading, onSessions])

  return { messages, loading, load, clear }
}
