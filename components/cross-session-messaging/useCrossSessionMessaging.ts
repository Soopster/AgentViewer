import { useCallback, useEffect, useRef, useState } from 'react'
import type { AddressableSession, SendCrossSessionMessageResult } from '@/lib/crossSessionMessagingTypes'
import type { MessagingFeedback, MessagingWorkspaceModel } from './types'
import { useDocumentVisible } from '@/components/shell/useDocumentVisible'

type MessagingOptions = { initialRecipient?: string; onRecipientChange?: (sessionId: string) => void }

export function useCrossSessionMessaging({ initialRecipient, onRecipientChange }: MessagingOptions = {}): MessagingWorkspaceModel {
  const [sessions, setSessions] = useState<AddressableSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [message, updateMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [deliveryFeedback, setDeliveryFeedback] = useState<MessagingFeedback | null>(null)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const visible = useDocumentVisible()
  const mountedRef = useRef(false)
  const selectedRef = useRef('')
  const selectionVersionRef = useRef(0)
  const draftRef = useRef({ text: '', version: 0 })
  const readRef = useRef<{ abort: AbortController; promise: Promise<void> } | null>(null)
  const sendRef = useRef<AbortController | null>(null)

  const setMessage = useCallback((text: string) => {
    draftRef.current = { text, version: draftRef.current.version + 1 }
    updateMessage(text)
  }, [])
  const select = useCallback((sessionId: string) => {
    if (selectedRef.current !== sessionId) selectionVersionRef.current++
    selectedRef.current = sessionId
    setSelectedSessionId(sessionId)
    setDeliveryFeedback(null)
  }, [])
  const selectSession = useCallback((sessionId: string) => {
    select(sessionId)
    onRecipientChange?.(sessionId)
  }, [select, onRecipientChange])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      readRef.current?.abort.abort()
      readRef.current = null
      sendRef.current?.abort()
      sendRef.current = null
    }
  }, [])

  const refresh = useCallback((foreground = true): Promise<void> => {
    if (!mountedRef.current) return Promise.resolve()
    if (foreground) setLoading(true)
    if (readRef.current) return readRef.current.promise
    const request = { abort: new AbortController(), promise: Promise.resolve() }
    readRef.current = request
    request.promise = (async () => {
      try {
        const response = await fetch('/api/agents', { cache: 'no-store', signal: request.abort.signal })
        const data = await response.json() as { sessions?: AddressableSession[]; error?: string }
        if (!response.ok) throw new Error(data.error || `Session discovery failed with HTTP ${response.status}`)
        if (request.abort.signal.aborted || readRef.current !== request) return
        const next = data.sessions ?? []
        setSessions(next)
        setDiscoveryError(null)
        if (!next.some(session => session.sessionId === selectedRef.current)) {
          const requested = initialRecipient ? next.find(session => session.sessionId === initialRecipient || session.name === initialRecipient) : undefined
          select(requested?.sessionId ?? next[0]?.sessionId ?? '')
        }
      } catch (cause) {
        if (!request.abort.signal.aborted && readRef.current === request) {
          setDiscoveryError(cause instanceof Error ? cause.message : 'Session discovery failed.')
        }
      } finally {
        if (readRef.current === request) {
          readRef.current = null
          // eslint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- inside finally; obsolete requests cannot finish a newer refresh
          setLoading(false)
        }
      }
    })()
    return request.promise
  }, [initialRecipient, select])

  useEffect(() => {
    if (!visible) return
    void refresh(false)
    const timer = window.setInterval(() => { void refresh(false) }, 5000)
    return () => {
      readRef.current?.abort.abort()
      readRef.current = null
      window.clearInterval(timer)
    }
  }, [visible, refresh])

  const hasDraft = !!message.trim()
  useEffect(() => {
    if (!hasDraft) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasDraft])

  const sendMessage = useCallback(async () => {
    const text = draftRef.current.text.trim()
    const to = selectedRef.current
    if (!mountedRef.current || !to || !text || sendRef.current) return
    const selectionVersion = selectionVersionRef.current
    const draftVersion = draftRef.current.version
    const abort = new AbortController()
    sendRef.current = abort
    setSending(true)
    setDeliveryFeedback(null)
    try {
      const response = await fetch('/api/agents/message', {
        method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, text, fromName: 'Agent Viewer' }),
      })
      const result = await response.json() as SendCrossSessionMessageResult
      if (!response.ok || !result.delivered) throw new Error(result.error || `Delivery failed with HTTP ${response.status}`)
      if (abort.signal.aborted) return
      if (selectionVersion === selectionVersionRef.current) {
        if (draftVersion === draftRef.current.version) setMessage('')
        setDeliveryFeedback({ kind: 'success', text: result.mode === 'steered'
          ? `Delivered to ${result.targetName ?? 'the running session'}.`
          : `Started a new turn for ${result.targetName ?? 'the session'}.` })
      }
      if (document.visibilityState !== 'hidden') void refresh(false)
    } catch (cause) {
      if (!abort.signal.aborted && selectionVersion === selectionVersionRef.current) {
        setDeliveryFeedback({ kind: 'error', text: cause instanceof Error ? cause.message : 'Delivery failed.' })
      }
    } finally {
      if (sendRef.current === abort) {
        sendRef.current = null
        // eslint-disable-next-line react-doctor/no-loading-flag-reset-outside-finally -- inside finally; only the owned delivery may finish this send
        setSending(false)
      }
    }
  }, [refresh, setMessage])

  return { sessions, selectedSessionId, message, setMessage, loading, sending,
    feedback: deliveryFeedback ?? (discoveryError ? { kind: 'error' as const, text: discoveryError } : null),
    refresh, selectSession, sendMessage }
}
