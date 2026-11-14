import type { PluginMessagingService } from '../../../lib/plugins/messaging'
import type { WebPluginViewProps } from '../../../components/shell/pluginTypes'
import { createPluginResourceScope } from '../../../lib/plugins/lifecycle'
import { useCallback, useEffect, useRef, useState } from 'react'
import { addressableSessionKey, resolveAddressableSession, type AddressableSession } from '@/lib/crossSessionMessagingTypes'
import type { MessagingFeedback, MessagingWorkspaceModel } from './types'
import { useDocumentVisible } from '@/components/shell/useDocumentVisible'

export type MessagingOptions = { service: PluginMessagingService; initialRecipient?: string; onRecipientChange?: (sessionId: string) => void; useState?: WebPluginViewProps['useState'] }
function useLocalState<T>(_name: string, initial: T) { return useState(initial) }

export function useCrossSessionMessaging({ service, initialRecipient, onRecipientChange, useState: useScopedState = useLocalState }: MessagingOptions): MessagingWorkspaceModel {
  const [sessions, setSessions] = useState<AddressableSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useScopedState('recipient', '')
  const [message, updateMessage] = useScopedState('draft', '')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [deliveryFeedback, setDeliveryFeedback] = useState<MessagingFeedback | null>(null)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)
  const visible = useDocumentVisible()
  const initialRecipientRef = useRef(initialRecipient)
  const mountedRef = useRef(false)
  const selectedRef = useRef(selectedSessionId)
  const selectionVersionRef = useRef(0)
  const draftRef = useRef({ text: message, version: 0 })
  const readRef = useRef<{ abort: AbortController; promise: Promise<void> } | null>(null)
  const sendRef = useRef<AbortController | null>(null)

  const setMessage = useCallback((text: string) => {
    draftRef.current = { text, version: draftRef.current.version + 1 }
    updateMessage(text)
  }, [updateMessage])
  const select = useCallback((sessionId: string) => {
    if (selectedRef.current !== sessionId) selectionVersionRef.current++
    selectedRef.current = sessionId
    setSelectedSessionId(sessionId)
    setDeliveryFeedback(null)
  }, [setSelectedSessionId])
  const selectSession = useCallback((sessionId: string) => {
    select(sessionId)
    setDiscoveryError(null)
    onRecipientChange?.(sessionId)
  }, [select, onRecipientChange])

  useEffect(() => {
    mountedRef.current = true
    const scope = createPluginResourceScope('messaging')
    scope.defer(() => {
      mountedRef.current = false
      readRef.current?.abort.abort()
      readRef.current = null
      sendRef.current?.abort()
      sendRef.current = null
    })
    return () => scope.dispose()
  }, [])

  const refresh = useCallback((foreground = true): Promise<void> => {
    if (!mountedRef.current) return Promise.resolve()
    if (foreground) setLoading(true)
    if (readRef.current) return readRef.current.promise
    const request = { abort: new AbortController(), promise: Promise.resolve() }
    readRef.current = request
    request.promise = (async () => {
      try {
        const next = await service.list(undefined, request.abort.signal)
        if (request.abort.signal.aborted || readRef.current !== request) return
        setSessions(next)
        setDiscoveryError(null)
        if (!next.some(session => addressableSessionKey(session) === selectedRef.current)) {
          const requestedAddress = initialRecipientRef.current
          const requested = requestedAddress ? resolveAddressableSession(next, requestedAddress) : next[0]
          select(requested ? addressableSessionKey(requested) : '')
          if (requestedAddress && !requested) setDiscoveryError('Choose a recipient: the requested address is missing or ambiguous.')
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
  }, [select, service])

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
      const result = await service.send({ toName: to, text, fromName: 'Agent Viewer' }, abort.signal)
      if (!result.delivered) throw new Error(result.error || 'Delivery failed.')
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
  }, [refresh, setMessage, service])

  return { sessions, selectedSessionId, message, setMessage, loading, sending,
    feedback: deliveryFeedback ?? (discoveryError ? { kind: 'error' as const, text: discoveryError } : null),
    refresh, selectSession, sendMessage }
}
