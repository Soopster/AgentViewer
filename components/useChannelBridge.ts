'use client'

// Shared controller for the local agentViewer channel bridge. A single instance
// owns the connection, the persisted config, the live event log, and the global
// "route composer through bridge" binding so that BOTH the dedicated panel
// (components/ChannelBridgePanel.tsx) and the main composer's send path
// (components/MessageView.tsx) speak to one connection instead of each opening
// their own. See lib/channelBridge.ts and channels/agentviewer-channel.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_CHANNEL_BRIDGE_URL,
  respondToChannelPermission,
  sendChannelMessage,
  subscribeToChannelEvents,
  type ChannelBridgeConfig,
  type ChannelBridgeStatus,
  type ChannelEvent,
  type ChannelPermissionRequestEvent,
} from '@/lib/channelBridge'

export type ChannelLogEntry =
  | { kind: 'sent'; id: string; text: string; chatId: string }
  | { kind: 'reply'; id: string; text: string; chatId: string }
  | { kind: 'permission'; id: string; request: ChannelPermissionRequestEvent; resolved?: 'allow' | 'deny' }

const CONFIG_STORAGE_KEY = 'agentviewer:channel-bridge-config'
const ROUTE_STORAGE_KEY = 'agentviewer:channel-bridge-route-composer'

type StoredConfig = { baseUrl: string; token: string }

function loadStoredConfig(): StoredConfig {
  if (typeof window === 'undefined') return { baseUrl: DEFAULT_CHANNEL_BRIDGE_URL, token: '' }
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY)
    if (!raw) return { baseUrl: DEFAULT_CHANNEL_BRIDGE_URL, token: '' }
    const parsed = JSON.parse(raw) as { baseUrl?: unknown; token?: unknown }
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? parsed.baseUrl : DEFAULT_CHANNEL_BRIDGE_URL,
      token: typeof parsed.token === 'string' ? parsed.token : '',
    }
  } catch {
    return { baseUrl: DEFAULT_CHANNEL_BRIDGE_URL, token: '' }
  }
}

function loadStoredRoute(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(ROUTE_STORAGE_KEY) === '1'
}

let entrySeq = 0
function nextEntryId(prefix: string): string {
  entrySeq += 1
  return `${prefix}-${entrySeq}`
}

export type ChannelBridge = {
  baseUrl: string
  token: string
  setBaseUrl: (value: string) => void
  setToken: (value: string) => void
  status: ChannelBridgeStatus
  entries: ChannelLogEntry[]
  sending: boolean
  sendError: string | null
  setSendError: (value: string | null) => void
  // Global binding: when true the main composer's send routes here instead of
  // the active provider. Persisted so the choice survives reloads.
  routeComposer: boolean
  setRouteComposer: (value: boolean) => void
  // Count of replies/permission prompts that arrived while the panel was closed.
  unread: number
  send: (text: string) => Promise<{ chat_id: string }>
  respond: (entry: Extract<ChannelLogEntry, { kind: 'permission' }>, behavior: 'allow' | 'deny') => Promise<void>
}

// `open` reflects whether the dedicated panel is visible. The connection stays
// live whenever the panel is open OR composer routing is enabled, and unread
// counting only accrues while the panel is closed.
export function useChannelBridge({ open, available }: { open: boolean; available: boolean }): ChannelBridge {
  const [stored] = useState(loadStoredConfig)
  const [baseUrl, setBaseUrl] = useState(stored.baseUrl)
  const [token, setToken] = useState(stored.token)
  const [routeComposerState, setRouteComposerState] = useState(loadStoredRoute)
  const [status, setStatus] = useState<ChannelBridgeStatus>('idle')
  const [entries, setEntries] = useState<ChannelLogEntry[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)

  const lastChatIdRef = useRef<string | undefined>(undefined)
  const openRef = useRef(open)
  openRef.current = open

  const config = useMemo<ChannelBridgeConfig>(() => ({ baseUrl, token: token || undefined }), [baseUrl, token])
  const routeComposer = available && routeComposerState
  const enabled = available && (open || routeComposer)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ baseUrl, token }))
  }, [baseUrl, token])

  const setRouteComposer = useCallback((value: boolean) => {
    const next = available && value
    setRouteComposerState(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ROUTE_STORAGE_KEY, next ? '1' : '0')
    }
  }, [available])

  useEffect(() => {
    if (available) return
    if (routeComposerState) setRouteComposer(false)
    lastChatIdRef.current = undefined
    setEntries([])
    setUnread(0)
    setSending(false)
    setSendError(null)
    setStatus('idle')
  }, [available, routeComposerState, setRouteComposer])

  // Clear the unread badge whenever the panel is opened.
  useEffect(() => {
    if (open) setUnread(0)
  }, [open])

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }
    const unsubscribe = subscribeToChannelEvents(
      config,
      (event: ChannelEvent) => {
        if (event.type === 'reply') {
          lastChatIdRef.current = event.chat_id
          setEntries((prev) => [
            ...prev,
            { kind: 'reply', id: nextEntryId('reply'), text: event.text, chatId: event.chat_id },
          ])
        } else {
          setEntries((prev) => [...prev, { kind: 'permission', id: nextEntryId('perm'), request: event }])
        }
        if (!openRef.current) setUnread((n) => n + 1)
      },
      (next) => setStatus(next),
    )
    return unsubscribe
  }, [config, enabled])

  const send = useCallback(
    async (text: string) => {
      if (!available) throw new Error('The channel bridge is only available for Claude sessions')
      const trimmed = text.trim()
      if (!trimmed) throw new Error('Cannot send an empty message')
      setSending(true)
      setSendError(null)
      try {
        const result = await sendChannelMessage(config, trimmed, lastChatIdRef.current)
        lastChatIdRef.current = result.chat_id
        setEntries((prev) => [...prev, { kind: 'sent', id: nextEntryId('sent'), text: trimmed, chatId: result.chat_id }])
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reach the channel bridge'
        setSendError(message)
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setSending(false)
      }
    },
    [available, config],
  )

  const respond = useCallback(
    async (entry: Extract<ChannelLogEntry, { kind: 'permission' }>, behavior: 'allow' | 'deny') => {
      if (!available) {
        setSendError('The channel bridge is only available for Claude sessions')
        return
      }
      setEntries((prev) => prev.map((item) => (item.id === entry.id ? { ...item, resolved: behavior } : item)))
      try {
        await respondToChannelPermission(config, entry.request.request_id, behavior)
      } catch (err) {
        setEntries((prev) => prev.map((item) => (item.id === entry.id ? { ...item, resolved: undefined } : item)))
        setSendError(err instanceof Error ? err.message : 'Failed to send the verdict')
      }
    },
    [available, config],
  )

  return {
    baseUrl,
    token,
    setBaseUrl,
    setToken,
    status,
    entries,
    sending,
    sendError,
    setSendError,
    routeComposer,
    setRouteComposer,
    unread,
    send,
    respond,
  }
}
