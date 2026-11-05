'use client'

// Shared controller for the agentViewer IDE host (channels/agentviewer-ide.ts),
// the third Claude composer flow. A single instance owns the connection, the
// persisted config, the live activity log, and the "route composer through IDE"
// binding so both the dedicated panel (components/IdeBridgePanel.tsx) and the
// main composer's send path (components/MessageView.tsx) share one connection.
//
// Unlike the channel bridge (a chat thread), the IDE protocol is one-way for
// prose — it has no "Claude replied" message. So this log is a feed of the IDE
// tool calls Claude makes against agentViewer (openFile, getDiagnostics, …) plus
// blocking openDiff cards the user accepts/rejects. The composer "send" pushes
// the typed path as an at-mention into the running session.
//
// See lib/ideBridge.ts and channels/agentviewer-ide.ts. Mirrors useChannelBridge.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_IDE_BRIDGE_URL,
  resolveIdeDiff,
  sendIdeAtMention,
  subscribeToIdeEvents,
  type IdeBridgeConfig,
  type IdeBridgeStatus,
  type IdeEvent,
  type IdeOpenDiffEvent,
} from '@/lib/ideBridge'

export type IdeLogEntry =
  | { kind: 'mention'; id: string; filePath: string; lineStart?: number; lineEnd?: number }
  | { kind: 'tool'; id: string; name: string; arguments: Record<string, unknown> }
  | { kind: 'diff'; id: string; request: IdeOpenDiffEvent; resolved?: 'accept' | 'reject' }
  | { kind: 'lifecycle'; id: string; event: 'connected' | 'disconnected' | 'initialized' }

const CONFIG_STORAGE_KEY = 'agentviewer:ide-bridge-config'
const ROUTE_STORAGE_KEY = 'agentviewer:ide-bridge-route-composer'

type StoredConfig = { baseUrl: string; token: string }

function loadStoredConfig(): StoredConfig {
  if (typeof window === 'undefined') return { baseUrl: DEFAULT_IDE_BRIDGE_URL, token: '' }
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY)
    if (!raw) return { baseUrl: DEFAULT_IDE_BRIDGE_URL, token: '' }
    const parsed = JSON.parse(raw) as { baseUrl?: unknown; token?: unknown }
    return {
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl ? parsed.baseUrl : DEFAULT_IDE_BRIDGE_URL,
      token: typeof parsed.token === 'string' ? parsed.token : '',
    }
  } catch {
    return { baseUrl: DEFAULT_IDE_BRIDGE_URL, token: '' }
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

// Drop the file:// prefix many IDE tools carry so the log reads cleanly.
function shortPath(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/^file:\/\//, '')
}

export type IdeBridge = {
  baseUrl: string
  token: string
  setBaseUrl: (value: string) => void
  setToken: (value: string) => void
  status: IdeBridgeStatus
  // Whether an external `claude` is currently connected to the IDE host.
  claudeConnected: boolean
  entries: IdeLogEntry[]
  sending: boolean
  sendError: string | null
  setSendError: (value: string | null) => void
  // Global binding: when true the main composer's send pushes the text as an
  // at-mention into the running session instead of the active provider.
  routeComposer: boolean
  setRouteComposer: (value: boolean) => void
  unread: number
  // Send a composer line as an at-mention. Accepts "path" or "path:start-end".
  send: (text: string) => Promise<{ delivered: boolean }>
  respondDiff: (entry: Extract<IdeLogEntry, { kind: 'diff' }>, behavior: 'accept' | 'reject') => Promise<void>
}

// Parse "path:10-20" / "path:10" / "path" into a file + optional line range.
function parseMention(text: string): { filePath: string; lineStart?: number; lineEnd?: number } {
  const match = text.match(/^(.*?):(\d+)(?:-(\d+))?$/)
  if (match) {
    const filePath = match[1]
    const lineStart = Number(match[2])
    const lineEnd = match[3] ? Number(match[3]) : lineStart
    return { filePath, lineStart, lineEnd }
  }
  return { filePath: text }
}

// `open` reflects whether the dedicated panel is visible. The connection stays
// live whenever the panel is open OR composer routing is enabled; unread
// counting only accrues while the panel is closed.
export function useIdeBridge({ open, available }: { open: boolean; available: boolean }): IdeBridge {
  const [stored] = useState(loadStoredConfig)
  const [baseUrl, setBaseUrl] = useState(stored.baseUrl)
  const [token, setToken] = useState(stored.token)
  const [routeComposerState, setRouteComposerState] = useState(loadStoredRoute)
  const [status, setStatus] = useState<IdeBridgeStatus>('idle')
  const [claudeConnected, setClaudeConnected] = useState(false)
  const [entries, setEntries] = useState<IdeLogEntry[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)

  const openRef = useRef(open)

  useEffect(() => {
    openRef.current = open
  }, [open])

  const config = useMemo<IdeBridgeConfig>(() => ({ baseUrl, token: token || undefined }), [baseUrl, token])
  const routeComposer = available && routeComposerState
  const enabled = available && (open || routeComposer)

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ baseUrl, token }))
  }, [baseUrl, token])

  const setRouteComposer = useCallback(
    (value: boolean) => {
      const next = available && value
      setRouteComposerState(next)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(ROUTE_STORAGE_KEY, next ? '1' : '0')
      }
    },
    [available],
  )

  useEffect(() => {
    if (available) return
    if (routeComposerState) setRouteComposer(false)
    setEntries([])
    setUnread(0)
    setSending(false)
    setSendError(null)
    setStatus('idle')
    setClaudeConnected(false)
  }, [available, routeComposerState, setRouteComposer])

  useEffect(() => {
    if (open) setUnread(0)
  }, [open])

  useEffect(() => {
    if (!enabled) {
      setStatus('idle')
      return
    }
    const unsubscribe = subscribeToIdeEvents(
      config,
      (event: IdeEvent) => {
        if (event.type === 'connected' || event.type === 'disconnected' || event.type === 'initialized') {
          setClaudeConnected(event.type !== 'disconnected')
          // Connection lifecycle is noisy on reconnect; only log transitions.
          setEntries((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.kind === 'lifecycle' && last.event === event.type) return prev
            return [...prev, { kind: 'lifecycle', id: nextEntryId('life'), event: event.type }]
          })
          return
        }
        if (event.type === 'open_diff') {
          const diffEvent = event
          setEntries((prev) => [...prev, { kind: 'diff', id: nextEntryId('diff'), request: diffEvent }])
        } else if (event.type === 'tool_call') {
          const { name, arguments: toolArgs } = event
          setEntries((prev) => [...prev, { kind: 'tool', id: nextEntryId('tool'), name, arguments: toolArgs }])
        }
        if (!openRef.current) setUnread((n) => n + 1)
      },
      (next) => setStatus(next),
    )
    return unsubscribe
  }, [config, enabled])

  const send = useCallback(
    async (text: string) => {
      if (!available) throw new Error('The IDE bridge is only available for Claude sessions')
      const trimmed = text.trim()
      if (!trimmed) throw new Error('Cannot send an empty at-mention')
      setSending(true)
      setSendError(null)
      try {
        const { filePath, lineStart, lineEnd } = parseMention(trimmed)
        const result = await sendIdeAtMention(config, filePath, lineStart, lineEnd)
        setEntries((prev) => [...prev, { kind: 'mention', id: nextEntryId('mention'), filePath, lineStart, lineEnd }])
        if (!result.delivered) {
          setSendError('No `claude` session is connected to the IDE host yet')
        }
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reach the IDE host'
        setSendError(message)
        throw err instanceof Error ? err : new Error(message)
      } finally {
        setSending(false)
      }
    },
    [available, config],
  )

  const respondDiff = useCallback(
    async (entry: Extract<IdeLogEntry, { kind: 'diff' }>, behavior: 'accept' | 'reject') => {
      if (!available) {
        setSendError('The IDE bridge is only available for Claude sessions')
        return
      }
      setEntries((prev) => prev.map((item) => (item.id === entry.id ? { ...item, resolved: behavior } : item)))
      try {
        await resolveIdeDiff(config, entry.request.diff_id, behavior)
      } catch (err) {
        setEntries((prev) =>
          prev.map((item) => (item.id === entry.id && item.kind === 'diff' ? { ...item, resolved: undefined } : item)),
        )
        setSendError(err instanceof Error ? err.message : 'Failed to send the diff verdict')
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
    claudeConnected,
    entries,
    sending,
    sendError,
    setSendError,
    routeComposer,
    setRouteComposer,
    unread,
    send,
    respondDiff,
  }
}

export { shortPath as ideShortPath }
