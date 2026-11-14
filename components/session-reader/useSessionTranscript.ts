import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionIdentityKey } from '@/lib/sessionIdentity'
import type { Session } from '@/lib/types'
import { MESSAGE_POLL_BACKFILL, type MessageStreamPayload } from './messageStream'
import { fetchSessionTranscript, pollSessionTranscript } from './transcriptApi'
import { applySessionTranscriptWindow, emptySessionTranscript, type SessionTranscriptWindow } from './sessionTranscriptWindow'
import { useSessionMessageStream } from './useSessionMessageStream'

export function useSessionTranscript({ session, visible }: { session: Session | null; visible: boolean }) {
  const [window, setWindow] = useState(emptySessionTranscript)
  const [loading, setLoading] = useState(false)
  const windowRef = useRef(window)
  const messageCountRef = useRef(0)
  const ownerRef = useRef<string | null>(null)
  const loadAbortRef = useRef<AbortController | null>(null)

  const publish = useCallback((next: SessionTranscriptWindow) => {
    windowRef.current = next
    messageCountRef.current = next.count
    setWindow(next)
  }, [])
  const clear = useCallback(() => {
    loadAbortRef.current?.abort()
    loadAbortRef.current = null
    ownerRef.current = null
    publish(emptySessionTranscript())
    setLoading(false)
  }, [publish])
  useEffect(() => () => {
    loadAbortRef.current?.abort()
    loadAbortRef.current = null
    ownerRef.current = null
  }, [])

  const load = useCallback(async (target: Session, targetMessageId?: string) => {
    clear()
    const key = sessionIdentityKey(target)
    ownerRef.current = key
    if (target.isPending) return
    const abort = new AbortController()
    loadAbortRef.current = abort
    setLoading(true)
    try {
      const loaded = await fetchSessionTranscript(target, targetMessageId, abort.signal)
      if (abort.signal.aborted || ownerRef.current !== key) return
      publish({
        messages: loaded.messages,
        count: loaded.offset + loaded.messages.length,
        fullTranscript: Boolean(targetMessageId),
        externalWriter: target.provider === 'codex' && loaded.externalWriter,
      })
    } catch (error) {
      if (!abort.signal.aborted) console.error('Failed to load messages:', error)
    } finally {
      if (loadAbortRef.current === abort) {
        loadAbortRef.current = null
        // eslint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- inside finally; the ownership guard prevents an old request from clearing a newer load
        setLoading(false)
      }
    }
  }, [clear, publish])

  const apply = useCallback((payload: MessageStreamPayload, expected: Session) => {
    if (loadAbortRef.current || ownerRef.current !== sessionIdentityKey(expected)) return
    publish(applySessionTranscriptWindow(windowRef.current, payload, expected))
  }, [publish])
  const poll = useCallback(async (target: Session, signal: AbortSignal) => {
    const current = windowRef.current
    const payload = await pollSessionTranscript(target,
      Math.max(0, current.count - MESSAGE_POLL_BACKFILL), current.cursorUuid, signal)
    if (!signal.aborted) apply(payload, target)
  }, [apply])
  const { todos, plan } = useSessionMessageStream({
    session, enabled: visible && !loading, messageCountRef, onMessages: apply, poll,
  })

  return { messages: window.messages, loading, externalWriter: window.externalWriter, todos, plan, load, clear }
}
