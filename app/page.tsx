'use client'

import { useState, useEffect, useRef, useCallback, useMemo, startTransition, ViewTransition } from 'react'
import dynamic from 'next/dynamic'
import SessionList from '@/components/SessionList'
import MessageView from '@/components/MessageView'
import { CodeThemeProvider } from '@/components/CodeThemeContext'
import { Sidebar, SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { isProviderSelection } from '@/lib/provider'
import { pathBasename, sameProjectPath } from '@/lib/projectPaths'
import { compactStableFingerprint } from '@/lib/compactFingerprint'
import { startClientPerf, measureAsync } from '@/lib/clientPerf'
import type { AgentProvider, ProviderSelection, Session, SessionMessage } from '@/lib/types'
import type { Todo as OpenCodeTodo } from '@opencode-ai/sdk'
import type { CodexPlanStep } from '@/lib/taskRegistry'

const CommandPalette = dynamic(() => import('@/components/CommandPalette'), { ssr: false })
const GitPopover = dynamic(() => import('@/components/GitPopover'), { ssr: false })
const BookmarksPanel = dynamic(() => import('@/components/BookmarksPanel'), { ssr: false })

type SessionScopeMode = 'all' | 'project'
type ProjectSelection = {
  key: string
  dir: string
  sessions: Session[]
}

type MessageTarget = {
  messageId: string
  requestId: number
}

type SessionListScrollRequest = {
  sessionKey: string
  requestId: number
}

type ProjectMessageBatch = {
  key: string
  sessionId: string
  provider?: AgentProvider
  offset: number
  messages: SessionMessage[]
}

const MESSAGE_POLL_BACKFILL = 20
const MESSAGE_STREAM_LIMIT = 200 + MESSAGE_POLL_BACKFILL
// Ceiling on the retained client transcript for a single live session. The
// streaming merge path otherwise grows without bound (only the project feed is
// trimmed), and every derivation off `messages` (threaded, row layout) scales
// with it. Set far above the 2000-message initial tail window so normal
// sessions never trim; only multi-thousand-turn live sessions hit it. Skipped
// entirely for deep-linked full-transcript loads (see fullTranscriptLoadedRef).
const SINGLE_SESSION_MESSAGE_MEMORY_LIMIT = 8000
const MESSAGE_POLL_FALLBACK_MS = 2000
const MESSAGE_STREAM_RETRY_INITIAL_MS = 2000
const MESSAGE_STREAM_RETRY_MAX_MS = 30000
// Project-feed memory caps. The view is recency-skewed and renders a virtual
// list, so dropping the cross-session ceiling to 2 500 (down from 5 000) plus
// 200 (from 300) per session removes ~50% of the SessionMessage objects held
// in browser memory for active dashboards without changing what's on-screen.
const PROJECT_MESSAGE_TOTAL_MEMORY_LIMIT = 2500
const PROJECT_MESSAGE_PER_SESSION_MEMORY_LIMIT = 200

type MessageStreamPayload = {
  sessionId?: string
  provider?: AgentProvider
  offset?: number
  total?: number
  messages?: SessionMessage[]
  replace?: boolean
}

function numericOffset(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function withProviderQuery(path: string, provider?: AgentProvider | 'all'): string {
  if (!provider) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}provider=${provider}`
}

function messageEventsPath(session: Session, offset: number): string {
  const params = new URLSearchParams()
  params.set('offset', String(offset))
  params.set('limit', String(MESSAGE_STREAM_LIMIT))
  params.set('backfill', String(MESSAGE_POLL_BACKFILL))
  if (session.provider) params.set('provider', session.provider)
  return `/api/sessions/${encodeURIComponent(session.sessionId)}/messages/events?${params.toString()}`
}

function messageTimestampMs(message: SessionMessage): number {
  if (message.timestamp) {
    const parsed = Date.parse(message.timestamp)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

function sessionMessageKey(message: SessionMessage): string {
  return `${message.provider ?? 'claude'}:${message.uuid}`
}

function projectMessageSessionKey(message: SessionMessage): string {
  return `${message.provider ?? 'claude'}:${message.session_id}`
}

function projectSessionKey(session: Pick<Session, 'sessionId' | 'provider'>): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

function dedupeSessionsByKey(sessions: Session[]): Session[] {
  const seen = new Set<string>()
  const result: Session[] = []
  for (const session of sessions) {
    const key = projectSessionKey(session)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(session)
  }
  return result
}

function sessionsFingerprint(sessions: Session[]): string {
  return sessions.map((s) => `${s.provider ?? 'claude'}:${s.sessionId}:${s.lastModified ?? s.createdAt ?? ''}`).join('|')
}

// Per-session fingerprint covering every field that affects how SessionRow
// renders. When the polled session has the same fingerprint as the one we
// already have, we reuse the prior object so React.memo on SessionRow can
// short-circuit — otherwise every 5s sessions poll replaces every Session
// reference and forces every row to re-render even when nothing visible
// changed.
function sessionRenderFingerprint(s: Session): string {
  return [
    s.sessionId,
    s.provider ?? '',
    s.customTitle ?? '',
    s.summary ?? '',
    s.firstPrompt ?? '',
    s.cwd ?? '',
    s.lastModified ?? '',
    s.createdAt ?? '',
    s.tag ?? '',
    s.parentSessionId ?? '',
    s.isPending ? '1' : '0',
  ].join('|')
}

function stabilizeSessionIdentities(prev: Session[], next: Session[]): Session[] {
  if (prev.length === 0) return next
  const priorByKey = new Map<string, Session>()
  for (const s of prev) priorByKey.set(`${s.provider ?? 'claude'}:${s.sessionId}`, s)
  let reusedAll = prev.length === next.length
  const stabilized = next.map((session) => {
    const prior = priorByKey.get(`${session.provider ?? 'claude'}:${session.sessionId}`)
    if (!prior) {
      reusedAll = false
      return session
    }
    if (sessionRenderFingerprint(prior) === sessionRenderFingerprint(session)) return prior
    reusedAll = false
    return session
  })
  return reusedAll ? prev : stabilized
}

// SessionMessage objects are immutable once created (mappers build fresh
// objects on every change; mergeMessages returns the SAME object when
// unchanged), so a given reference always hashes to the same signature.
// Cache by identity so stable existing-side messages aren't deep-hashed on
// every poll/SSE tick — the bulk of per-tick main-thread CPU during long
// streaming replies into a ~220-message window. WeakMap self-collects when a
// session switch drops the references.
const apiSignatureCache = new WeakMap<SessionMessage, string>()
function apiMessageSignature(message: SessionMessage): string {
  const cached = apiSignatureCache.get(message)
  if (cached !== undefined) return cached
  const originKind = message.origin?.kind ?? ''
  const turnId = message.turnId ?? ''
  const timestamp = message.timestamp ?? ''
  const payload = compactStableFingerprint(message.message)
  const signature = [message.type, timestamp, originKind, turnId, payload].join('|')
  apiSignatureCache.set(message, signature)
  return signature
}

function mergeSortedMessages(existing: SessionMessage[], incoming: SessionMessage[]): SessionMessage[] {
  const merged: SessionMessage[] = []
  let existingIndex = 0
  let incomingIndex = 0

  while (existingIndex < existing.length && incomingIndex < incoming.length) {
    if (messageTimestampMs(existing[existingIndex]) <= messageTimestampMs(incoming[incomingIndex])) {
      merged.push(existing[existingIndex])
      existingIndex += 1
    } else {
      merged.push(incoming[incomingIndex])
      incomingIndex += 1
    }
  }

  if (existingIndex < existing.length) merged.push(...existing.slice(existingIndex))
  if (incomingIndex < incoming.length) merged.push(...incoming.slice(incomingIndex))
  return merged
}

function mergeMessages(existing: SessionMessage[], incoming: SessionMessage[]): SessionMessage[] {
  if (incoming.length === 0) return existing

  const latestIncomingByKey = new Map<string, SessionMessage>()
  for (const message of incoming) latestIncomingByKey.set(sessionMessageKey(message), message)

  let changed = false
  const appended: SessionMessage[] = []
  const matchedKeys = new Set<string>()

  const mergedExisting = existing.map((message) => {
    const key = sessionMessageKey(message)
    const replacement = latestIncomingByKey.get(key)
    if (!replacement) return message
    matchedKeys.add(key)
    if (apiMessageSignature(message) === apiMessageSignature(replacement)) return message
    changed = true
    return replacement
  })

  for (const [key, message] of latestIncomingByKey) {
    if (matchedKeys.has(key)) continue
    appended.push(message)
    changed = true
  }

  if (!changed) return existing
  if (appended.length === 0) return mergedExisting

  const additions = appended.sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b))
  return mergeSortedMessages(mergedExisting, additions)
}

function trimProjectMessagesForMemory(messages: SessionMessage[]): SessionMessage[] {
  if (messages.length <= PROJECT_MESSAGE_TOTAL_MEMORY_LIMIT) {
    const counts = new Map<string, number>()
    let exceedsPerSessionLimit = false
    for (const message of messages) {
      const key = projectMessageSessionKey(message)
      const next = (counts.get(key) ?? 0) + 1
      if (next > PROJECT_MESSAGE_PER_SESSION_MEMORY_LIMIT) {
        exceedsPerSessionLimit = true
        break
      }
      counts.set(key, next)
    }
    if (!exceedsPerSessionLimit) return messages
  }

  const kept: SessionMessage[] = []
  const counts = new Map<string, number>()
  for (let i = messages.length - 1; i >= 0 && kept.length < PROJECT_MESSAGE_TOTAL_MEMORY_LIMIT; i -= 1) {
    const message = messages[i]
    const key = projectMessageSessionKey(message)
    const count = counts.get(key) ?? 0
    if (count >= PROJECT_MESSAGE_PER_SESSION_MEMORY_LIMIT) continue
    counts.set(key, count + 1)
    kept.push(message)
  }
  kept.reverse()
  return kept
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  )
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

export default function Home() {
  const [messagePaneCollapsed, setMessagePaneCollapsed] = useState(
    () => typeof document !== 'undefined' && document.documentElement.dataset.msgPane === 'collapsed'
  )
  const [sessions, setSessions] = useState<Session[]>([])
  const [openTabSessions, setOpenTabSessions] = useState<Session[]>([])
  const [selectedTabKey, setSelectedTabKey] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<ProjectSelection | null>(null)
  const [targetMessage, setTargetMessage] = useState<MessageTarget | null>(null)
  const [sessionListScrollRequest, setSessionListScrollRequest] = useState<SessionListScrollRequest | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const selectedTabKeyRef = useRef<string | null>(null)
  // OpenCode `todo.updated` events arrive via the messages SSE stream and
  // are surfaced as a pinned card in MessageView. Keyed by sessionId so a
  // tab swap doesn't show another session's todos.
  const [sessionTodos, setSessionTodos] = useState<OpenCodeTodo[]>([])
  const [todosForSessionId, setTodosForSessionId] = useState<string | null>(null)
  // Codex `turn/plan/updated` mirrors OpenCode todos — structured plan
  // steps surface in the Tasks panel.
  const [sessionPlan, setSessionPlan] = useState<{ plan: CodexPlanStep[]; explanation: string | null }>({ plan: [], explanation: null })
  const [planForSessionId, setPlanForSessionId] = useState<string | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderSelection>('claude')
  const [switchingProvider, setSwitchingProvider] = useState(false)
  const [sessionScope, setSessionScope] = useState<SessionScopeMode>('all')
  const [includeWorktrees, setIncludeWorktrees] = useState(true)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [gitPopoverOpen, setGitPopoverOpen] = useState(false)
  const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false)
  const [taskPanelOpenRequest, setTaskPanelOpenRequest] = useState(0)
  const documentVisible = useDocumentVisible()
  // Tracks the absolute transcript offset immediately after the latest loaded
  // message window. This is not always messages.length because session loads
  // use tail windows for long transcripts.
  const msgCountRef = useRef(0)
  // True when the active transcript was loaded in full via the deep-link
  // (all=1) path, so the head-trim below must NOT evict the anchored history.
  const fullTranscriptLoadedRef = useRef(false)
  const projectMessageCountsRef = useRef<Map<string, number>>(new Map())
  // Guards to prevent concurrent poll ticks from overlapping when a fetch takes > interval
  const pollInFlightRef = useRef(false)
  const projectPollInFlightRef = useRef(false)
  const sessionsFingerprintRef = useRef('')
  const targetMessageRequestRef = useRef(0)
  const sessionListScrollRequestRef = useRef(0)
  // Cancels the previous session-switch fetch so a slow A response can't overwrite B's messages
  const sessionLoadAbortRef = useRef<AbortController | null>(null)
  // Memoize the selected session lookup so MessageView and effects that
  // depend on it don't see a new object reference on every render of this
  // page (which used to fire on every keystroke into the composer).
  const selectedSession = useMemo(
    () =>
      openTabSessions.find((s) => projectSessionKey(s) === selectedTabKey) ??
      sessions.find((s) => projectSessionKey(s) === selectedTabKey) ??
      null,
    [openTabSessions, sessions, selectedTabKey],
  )
  selectedTabKeyRef.current = selectedTabKey
  const activeProjectDir = selectedProject?.dir ?? selectedSession?.cwd ?? null
  const activeProjectName = selectedProject?.key ?? (pathBasename(activeProjectDir) || null)
  const messageAreaKey = selectedTabKey ?? (selectedProject ? `proj:${selectedProject.dir}` : '')
  // Bundle the projectView prop so it only gets a new identity when one of
  // its fields actually changes — otherwise <MessageView /> sees a new object
  // on every parent render.
  const projectViewProp = useMemo(
    () => (selectedProject
      ? {
          key: selectedProject.key,
          sessionCount: selectedProject.sessions.length,
          providerMode: (provider === 'all' ? 'all' : 'current') as 'all' | 'current',
        }
      : undefined),
    [provider, selectedProject],
  )
  const openCodeTodosForView = todosForSessionId === selectedSession?.sessionId ? sessionTodos : undefined
  const codexPlanForView = planForSessionId === selectedSession?.sessionId && sessionPlan.plan.length > 0
    ? sessionPlan
    : undefined

  const toggleMessagePane = useCallback(() => {
    setMessagePaneCollapsed((prev) => {
      const next = !prev
      try { window.localStorage.setItem('agentViewer:messagePaneCollapsed', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])

  const openGitPopover = useCallback(() => {
    if (!activeProjectDir) return
    setGitPopoverOpen(true)
  }, [activeProjectDir])

  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), [])
  const openTaskPanel = useCallback(() => setTaskPanelOpenRequest((value) => value + 1), [])

  const fetchProjectSessions = useCallback(async (dir: string, selection: ProviderSelection) => {
    const params = new URLSearchParams()
    params.set('dir', dir)
    params.set('includeWorktrees', String(includeWorktrees))
    params.set('limit', '500')
    params.set('provider', selection)
    const response = await fetch(`/api/sessions?${params.toString()}`)
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
    return (data.sessions ?? []) as Session[]
  }, [includeWorktrees])

  const fetchSessionMessages = useCallback(async (session: Session, targetMessageId?: string, signal?: AbortSignal) => {
    const query = targetMessageId
      ? 'limit=100000&all=1'
      : 'limit=2000&tail=1'
    const response = await fetch(
      withProviderQuery(`/api/sessions/${session.sessionId}/messages?${query}`, session.provider),
      { signal },
    )
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
    return {
      offset: numericOffset(data.offset),
      total: numericOffset(data.total, numericOffset(data.offset) + ((data.messages ?? []) as SessionMessage[]).length),
      messages: (data.messages ?? []) as SessionMessage[],
    }
  }, [])

  const loadSessionsForProvider = useCallback(async (
    selection: ProviderSelection,
    scopeMode: SessionScopeMode = sessionScope,
    projectDir: string | null = activeProjectDir,
  ) => {
    if (scopeMode === 'project' && projectDir) {
      const loaded = await fetchProjectSessions(projectDir, selection)
      const fp = sessionsFingerprint(loaded)
      if (fp !== sessionsFingerprintRef.current) {
        sessionsFingerprintRef.current = fp
        startTransition(() => {
          setSessions((prev) => stabilizeSessionIdentities(prev, loaded))
        })
      }
      return
    }

    const params = new URLSearchParams()
    params.set('provider', selection)
    params.set('limit', '500')
    const suffix = params.toString() ? `?${params.toString()}` : ''
    const data = await measureAsync('fetch.sessions', async () => {
      const r = await fetch(`/api/sessions${suffix}`)
      return r.json()
    })
    if (data.error) throw new Error(data.error)
    const loaded = (data.sessions ?? []) as Session[]
    const fp = sessionsFingerprint(loaded)
    if (fp !== sessionsFingerprintRef.current) {
      sessionsFingerprintRef.current = fp
      startTransition(() => {
        setSessions((prev) => stabilizeSessionIdentities(prev, loaded))
      })
    }
  }, [activeProjectDir, fetchProjectSessions, sessionScope])

  const fetchSessions = useCallback(async () => {
    await loadSessionsForProvider(provider)
  }, [loadSessionsForProvider, provider])

  const fetchProjectMessageBatches = useCallback(async (
    dir: string,
    selection: ProviderSelection,
    offsets: Record<string, number>,
  ): Promise<{ sessions: Session[]; batches: ProjectMessageBatch[] }> => {
    const response = await fetch('/api/sessions/project/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dir,
        includeWorktrees,
        provider: selection,
        offsets,
        initialLimit: 300,
        incrementalLimit: 200,
      }),
    })
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
    return {
      sessions: (data.sessions ?? []) as Session[],
      batches: (data.batches ?? []) as ProjectMessageBatch[],
    }
  }, [includeWorktrees])

  const fetchProvider = useCallback(async () => {
    const r = await fetch('/api/provider')
    const data = await r.json()
    if (data.error) throw new Error(data.error)
    const nextProvider = isProviderSelection(data.provider) ? data.provider : 'claude'
    setProvider(nextProvider)
    return nextProvider
  }, [])

  const applySessionMessagePayload = useCallback((payload: MessageStreamPayload, expectedSession: Session) => {
    if (selectedTabKeyRef.current !== projectSessionKey(expectedSession)) return
    if (payload.sessionId && payload.sessionId !== expectedSession.sessionId) return
    if (payload.provider && payload.provider !== (expectedSession.provider ?? 'claude')) return

    const incoming = Array.isArray(payload.messages) ? payload.messages : []
    const offset = numericOffset(payload.offset, Math.max(0, msgCountRef.current - incoming.length))
    const nextOffset = offset + incoming.length
    const total = numericOffset(payload.total, nextOffset)
    const replaceWindow = payload.replace === true || total < msgCountRef.current
    if (incoming.length === 0) {
      if (replaceWindow) {
        msgCountRef.current = total
        fullTranscriptLoadedRef.current = false
        setMessages([])
      }
      return
    }
    // A replacement/shrunk window is a fresh bounded tail — the full-transcript
    // invariant no longer holds, so trimming may resume.
    if (replaceWindow) fullTranscriptLoadedRef.current = false
    msgCountRef.current = replaceWindow ? nextOffset : Math.max(msgCountRef.current, nextOffset)
    setMessages((prev) => {
      if (replaceWindow) return incoming
      const merged = mergeMessages(prev, incoming)
      // Preserve mergeMessages' identity bail-out (unchanged → same array) so
      // React skips the re-render; only allocate a slice when we actually trim.
      if (merged === prev) return prev
      if (fullTranscriptLoadedRef.current || merged.length <= SINGLE_SESSION_MESSAGE_MEMORY_LIMIT) return merged
      return merged.slice(merged.length - SINGLE_SESSION_MESSAGE_MEMORY_LIMIT)
    })
  }, [])

  const pollSelectedSessionMessages = useCallback(async (session: Session) => {
    if (pollInFlightRef.current) return
    pollInFlightRef.current = true
    const offset = Math.max(0, msgCountRef.current - MESSAGE_POLL_BACKFILL)
    try {
      const r = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}/messages?offset=${offset}&limit=${MESSAGE_STREAM_LIMIT}`, session.provider))
      const data = await r.json()
      if (!data.error) applySessionMessagePayload(data as MessageStreamPayload, session)
    } catch { /* ignore transient errors */ } finally {
      pollInFlightRef.current = false
    }
  }, [applySessionMessagePayload])

  // Opt-in client perf monitor (?perf=1 or localStorage 'agentviewer:perf'=1).
  // No-op unless enabled. See lib/clientPerf.ts.
  useEffect(() => startClientPerf(), [])

  // Initial session load
  useEffect(() => {
    let cancelled = false
    setLoadingSessions(true)
    Promise.resolve()
      .then(async () => {
        const nextProvider = await fetchProvider()
        await loadSessionsForProvider(nextProvider)
      })
      .catch((err) => {
        if (!cancelled) setSessionsError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingSessions(false)
      })
    return () => { cancelled = true }
  }, [fetchProvider, loadSessionsForProvider])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() !== 'g') return
      if (!activeProjectDir) return
      event.preventDefault()
      setGitPopoverOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeProjectDir])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setCommandPaletteOpen((prev) => !prev)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Poll sessions list silently every 5 s while the tab is visible.
  useEffect(() => {
    if (!documentVisible) return
    const id = setInterval(() => {
      fetchSessions()
        .catch(() => {})
    }, 5000)
    return () => clearInterval(id)
  }, [fetchSessions, documentVisible])

  // Keep open tab metadata (title, tag, etc.) in sync with polled sessions
  useEffect(() => {
    setOpenTabSessions((prev) => prev.map((tab) => {
      const updated = sessions.find((s) =>
        s.sessionId === tab.sessionId && (s.provider ?? 'claude') === (tab.provider ?? 'claude'),
      )
      return updated ?? tab
    }))
  }, [sessions])

  useEffect(() => {
    setSelectedProject((prev) => {
      if (!prev) return prev
      const nextSessions = sessions.filter((s) => sameProjectPath(prev.dir, s.cwd))
      if (nextSessions.length === 0) return provider === 'all' && sessionScope !== 'project' ? prev : null
      return { ...prev, sessions: nextSessions }
    })
  }, [provider, sessionScope, sessions])

  useEffect(() => {
    if (sessionScope === 'project' && !activeProjectDir) {
      setSessionScope('all')
    }
  }, [activeProjectDir, sessionScope])

  useEffect(() => {
    if (!selectedTabKey) return
    if (openTabSessions.some((s) => projectSessionKey(s) === selectedTabKey)) return
    if (sessions.some((s) => projectSessionKey(s) === selectedTabKey)) return
    setSelectedTabKey(null)
    msgCountRef.current = 0
    setMessages([])
  }, [openTabSessions, selectedTabKey, sessions])

  useEffect(() => {
    if (selectedProject) return
    projectMessageCountsRef.current.clear()
  }, [selectedProject])

  // Drop stale opencode todos when the active session changes — they're
  // session-scoped and re-emitted by the stream's snapshot replay.
  useEffect(() => {
    const activeSessionId = selectedSession?.sessionId ?? null
    if (todosForSessionId && todosForSessionId !== activeSessionId) {
      setSessionTodos([])
      setTodosForSessionId(null)
    }
    if (planForSessionId && planForSessionId !== activeSessionId) {
      setSessionPlan({ plan: [], explanation: null })
      setPlanForSessionId(null)
    }
  }, [selectedSession?.sessionId, todosForSessionId, planForSessionId])

  // Stream active single-session updates; fall back to the old poll loop if SSE drops.
  // eslint-disable-next-line react-doctor/effect-needs-cleanup -- cleanup is returned below; it calls eventSource.close(), the canonical EventSource teardown (releases all addEventListener handlers)
  useEffect(() => {
    if (!selectedSession || selectedProject || loadingMessages) return
    if (selectedSession.isPending) return
    if (!documentVisible) return

    const session = selectedSession
    let cancelled = false
    let eventSource: EventSource | null = null
    let fallbackInterval: number | null = null
    let retryTimeout: number | null = null
    let retryDelay = MESSAGE_STREAM_RETRY_INITIAL_MS

    const stopFallbackPolling = () => {
      if (fallbackInterval == null) return
      window.clearInterval(fallbackInterval)
      fallbackInterval = null
    }

    const startFallbackPolling = () => {
      if (fallbackInterval != null) return
      void pollSelectedSessionMessages(session)
      fallbackInterval = window.setInterval(() => {
        void pollSelectedSessionMessages(session)
      }, MESSAGE_POLL_FALLBACK_MS)
    }

    const scheduleReconnect = (connect: () => void) => {
      if (retryTimeout != null) return
      retryTimeout = window.setTimeout(() => {
        retryTimeout = null
        connect()
      }, retryDelay)
      retryDelay = Math.min(retryDelay * 2, MESSAGE_STREAM_RETRY_MAX_MS)
    }

    const connect = () => {
      if (cancelled) return
      if (typeof EventSource === 'undefined') {
        startFallbackPolling()
        return
      }

      const offset = Math.max(0, msgCountRef.current - MESSAGE_POLL_BACKFILL)
      const source = new EventSource(messageEventsPath(session, offset))
      eventSource = source

      source.onopen = () => {
        retryDelay = MESSAGE_STREAM_RETRY_INITIAL_MS
        stopFallbackPolling()
      }

      source.addEventListener('messages', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as MessageStreamPayload
          applySessionMessagePayload(payload, session)
        } catch { /* ignore malformed stream payloads */ }
      })

      source.addEventListener('todos', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as { sessionId?: string; todos?: OpenCodeTodo[] }
          if (!payload.sessionId || payload.sessionId !== session.sessionId) return
          setTodosForSessionId(payload.sessionId)
          setSessionTodos(Array.isArray(payload.todos) ? payload.todos : [])
        } catch { /* ignore malformed stream payloads */ }
      })

      source.addEventListener('plan', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as {
            sessionId?: string
            plan?: CodexPlanStep[]
            explanation?: string | null
          }
          if (!payload.sessionId || payload.sessionId !== session.sessionId) return
          setPlanForSessionId(payload.sessionId)
          setSessionPlan({
            plan: Array.isArray(payload.plan) ? payload.plan : [],
            explanation: typeof payload.explanation === 'string' ? payload.explanation : null,
          })
        } catch { /* ignore malformed stream payloads */ }
      })

      source.onerror = () => {
        if (cancelled) return
        source.close()
        if (eventSource === source) eventSource = null
        startFallbackPolling()
        scheduleReconnect(connect)
      }
    }

    connect()

    return () => {
      cancelled = true
      eventSource?.close()
      stopFallbackPolling()
      if (retryTimeout != null) {
        window.clearTimeout(retryTimeout)
      }
    }
  }, [
    loadingMessages,
    applySessionMessagePayload,
    pollSelectedSessionMessages,
    selectedProject,
    selectedSession?.isPending,
    selectedSession?.provider,
    selectedSession?.sessionId,
    documentVisible,
  ])

  // Poll project view every 2 s using per-session incremental fetches.
  useEffect(() => {
    if (!selectedProject) return
    if (!documentVisible) return
    const id = setInterval(async () => {
      if (projectPollInFlightRef.current) return
      projectPollInFlightRef.current = true
      try {
        const offsets = Object.fromEntries(
          Array.from(projectMessageCountsRef.current.entries(), ([key, count]) => [
            key,
            Math.max(0, count - MESSAGE_POLL_BACKFILL),
          ])
        )
        const { sessions: projectSessions, batches } = await fetchProjectMessageBatches(selectedProject.dir, provider, offsets)
        for (const batch of batches) {
          const previousCount = projectMessageCountsRef.current.get(batch.key) ?? 0
          projectMessageCountsRef.current.set(
            batch.key,
            Math.max(previousCount, batch.offset + batch.messages.length)
          )
        }
        const incoming = batches.flatMap((batch) => batch.messages)
        if (incoming.length > 0) {
          setMessages((prev) => trimProjectMessagesForMemory(mergeMessages(prev, incoming)))
        }
        setSelectedProject((prev) => prev && sameProjectPath(prev.dir, selectedProject.dir)
          ? { ...prev, sessions: projectSessions }
          : prev
        )
      } catch { /* ignore transient errors */ } finally {
        projectPollInFlightRef.current = false
      }
    }, 2000)
    return () => clearInterval(id)
  }, [fetchProjectMessageBatches, provider, selectedProject, documentVisible])

  const selectSession = useCallback(async (session: Session, nextTargetMessageId?: string) => {
    const nextProvider = session.provider ?? 'claude'
    const nextScopeMode: SessionScopeMode = 'all'
    if (nextProvider !== provider) {
      setProvider(nextProvider)
      setLoadingSessions(true)
      void loadSessionsForProvider(nextProvider, nextScopeMode, null)
        .catch((err) => setSessionsError(err instanceof Error ? err.message : 'Failed to sync sessions'))
        .finally(() => setLoadingSessions(false))
    }
    startTransition(() => {
      setOpenTabSessions((prev) => {
        const key = projectSessionKey(session)
        const alreadyOpen = prev.some((s) => projectSessionKey(s) === key)
        if (!alreadyOpen) return [...prev, session]
        return prev.map((s) => {
          if (projectSessionKey(s) !== key) return s
          const merged: Session = { ...s, ...session }
          if (session.isPending === undefined) delete merged.isPending
          return merged
        })
      })
      setSelectedTabKey(projectSessionKey(session))
      setSelectedProject(null)
      setTargetMessage(nextTargetMessageId
        ? { messageId: nextTargetMessageId, requestId: ++targetMessageRequestRef.current }
        : null
      )
    })
    projectMessageCountsRef.current.clear()
    msgCountRef.current = 0
    // Clear before the pending-session early-return below so a stale `true`
    // from a previously deep-linked session can't disable trimming here. The
    // non-pending path re-sets it from nextTargetMessageId after the load.
    fullTranscriptLoadedRef.current = false
    setLoadingMessages(true)
    setMessages([])
    sessionLoadAbortRef.current?.abort()
    if (session.isPending) {
      sessionLoadAbortRef.current = null
      setLoadingMessages(false)
      return
    }
    const abortController = new AbortController()
    sessionLoadAbortRef.current = abortController
    try {
      const loadedWindow = await fetchSessionMessages(session, nextTargetMessageId, abortController.signal)
      if (abortController.signal.aborted) return
      msgCountRef.current = loadedWindow.offset + loadedWindow.messages.length
      fullTranscriptLoadedRef.current = Boolean(nextTargetMessageId)
      setMessages(loadedWindow.messages)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.error('Failed to load messages:', err)
    } finally {
      if (sessionLoadAbortRef.current === abortController) {
        sessionLoadAbortRef.current = null
      }
      if (!abortController.signal.aborted) setLoadingMessages(false)
    }
  }, [fetchSessionMessages, provider, loadSessionsForProvider])

  const scrollSessionListToSession = useCallback((session: Session) => {
    setSessionListScrollRequest({
      sessionKey: projectSessionKey(session),
      requestId: ++sessionListScrollRequestRef.current,
    })
  }, [])

  const selectOpenTab = useCallback((session: Session) => {
    scrollSessionListToSession(session)
    void selectSession(session)
  }, [scrollSessionListToSession, selectSession])

  const selectCommandPaletteSession = useCallback((session: Session, nextTargetMessageId?: string) => {
    scrollSessionListToSession(session)
    void selectSession(session, nextTargetMessageId)
  }, [scrollSessionListToSession, selectSession])

  function closeTab(sessionKey: string) {
    const idx = openTabSessions.findIndex((s) => projectSessionKey(s) === sessionKey)
    const next = openTabSessions.filter((s) => projectSessionKey(s) !== sessionKey)
    startTransition(() => { setOpenTabSessions(next) })
    if (sessionKey === selectedTabKey) {
      if (next.length > 0) {
        const adjacent = next[Math.min(idx, next.length - 1)]
        if (adjacent) void selectSession(adjacent)
      } else {
        startTransition(() => {
          setSelectedTabKey(null)
          setTargetMessage(null)
          msgCountRef.current = 0
          setMessages([])
        })
      }
    }
  }

  const selectProject = useCallback(async (projectDir: string, projectName: string, projectSessions: Session[]) => {
    startTransition(() => {
      setSelectedProject({ key: projectName, dir: projectDir, sessions: projectSessions })
      setSelectedTabKey(null)
      setTargetMessage(null)
    })
    msgCountRef.current = 0
    setLoadingMessages(true)
    setMessages([])
    try {
      const { sessions: sessionsForProject, batches } = await fetchProjectMessageBatches(
        projectDir,
        provider === 'all' ? 'all' : provider,
        {},
      )
      const all = batches.flatMap((batch) => batch.messages) as SessionMessage[]
      all.sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b))
      projectMessageCountsRef.current = new Map(
        batches.map((batch) => [batch.key, batch.offset + batch.messages.length])
      )
      setMessages(trimProjectMessagesForMemory(all))
      setSelectedProject({ key: projectName, dir: projectDir, sessions: sessionsForProject })
    } catch (err) {
      console.error('Failed to load project messages:', err)
    } finally {
      setLoadingMessages(false)
    }
  }, [provider])

  // Optimistically update the session title shown by listSessions().
  const handleRename = useCallback((sessionId: string, title: string) => {
    setSessions(prev => prev.map(s =>
      s.sessionId === sessionId ? { ...s, customTitle: title, summary: title } : s
    ))
    // Also update selectedProject sessions if active
    setSelectedProject(prev => {
      if (!prev) return prev
      return {
        ...prev,
        sessions: prev.sessions.map(s =>
          s.sessionId === sessionId ? { ...s, customTitle: title, summary: title } : s
        ),
      }
    })
  }, [])

  const handleTag = useCallback((sessionId: string, tag: string | null) => {
    setSessions(prev => prev.map(s =>
      s.sessionId === sessionId ? { ...s, tag } : s
    ))
    setSelectedProject(prev => {
      if (!prev) return prev
      return {
        ...prev,
        sessions: prev.sessions.map(s =>
          s.sessionId === sessionId ? { ...s, tag } : s
        ),
      }
    })
  }, [])

  // Navigate to a newly forked session, or materialize a provider-created
  // pending tab after its first streamed session event.
  const handleFork = useCallback((newSessionId: string) => {
    if (!selectedSession?.provider) return
    if (selectedSession.isPending) {
      const oldKey = projectSessionKey(selectedSession)
      const materialized: Session = {
        ...selectedSession,
        sessionId: newSessionId,
        isPending: false,
        lastModified: Date.now(),
      }
      const newKey = projectSessionKey(materialized)
      setOpenTabSessions((prev) => {
        const replaced = prev.map((session) =>
          projectSessionKey(session) === oldKey ? materialized : session
        )
        const next = replaced.some((session) => projectSessionKey(session) === newKey)
          ? replaced
          : [...replaced, materialized]
        return dedupeSessionsByKey(next)
      })
      setSessions((prev) => prev.map((session) =>
        projectSessionKey(session) === oldKey || projectSessionKey(session) === newKey
          ? { ...session, ...materialized }
          : session
      ))
      setSelectedProject((prev) => prev
        ? {
            ...prev,
            sessions: prev.sessions.map((session) =>
              projectSessionKey(session) === oldKey || projectSessionKey(session) === newKey
                ? { ...session, ...materialized }
                : session
            ),
          }
        : prev
      )
      setSelectedTabKey(newKey)
      void selectSession(materialized)
      return
    }
    void selectSession({ sessionId: newSessionId, provider: selectedSession.provider } as Session)
  }, [selectSession, selectedSession])

  const handleDelete = useCallback((sessionId: string, deletedProvider?: AgentProvider) => {
    const sameSession = (session: Session) =>
      session.sessionId === sessionId && (!deletedProvider || (session.provider ?? 'claude') === deletedProvider)
    const deletedTabKey = deletedProvider ? `${deletedProvider}:${sessionId}` : null
    setSessions((prev) => prev.filter((session) => !sameSession(session)))
    setOpenTabSessions((prev) => prev.filter((session) => !sameSession(session)))
    setSelectedProject((prev) => prev
      ? { ...prev, sessions: prev.sessions.filter((session) => !sameSession(session)) }
      : prev
    )
    if (selectedTabKey && (deletedTabKey ? selectedTabKey === deletedTabKey : openTabSessions.some((session) => session.sessionId === sessionId))) {
      setSelectedTabKey(null)
      setTargetMessage(null)
      msgCountRef.current = 0
      setMessages([])
    }
  }, [openTabSessions, selectedTabKey])

  const [creatingNewSession, setCreatingNewSession] = useState(false)
  const handleNewSession = useCallback(async () => {
    if (creatingNewSession) return
    const activeProvider = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
    setCreatingNewSession(true)
    setSessionsError(null)
    try {
      const cwd = activeProjectDir ?? selectedSession?.cwd ?? undefined
      const res = await fetch('/api/sessions/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: activeProvider, cwd }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      const draft: Session = {
        sessionId: data.sessionId,
        provider: data.provider ?? activeProvider,
        cwd: data.cwd,
        createdAt: Date.now(),
        lastModified: Date.now(),
        summary: 'New session',
        isPending: Boolean(data.isPending),
      }
      await selectSession(draft)
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setCreatingNewSession(false)
    }
  }, [activeProjectDir, creatingNewSession, provider, selectSession, selectedSession?.cwd, selectedSession?.provider])

  const handleChangeProvider = useCallback(async (nextProvider: ProviderSelection) => {
    if (nextProvider === provider || switchingProvider) return
    const nextScopeMode = sessionScope
    const nextProjectDir = activeProjectDir
    setSwitchingProvider(true)
    setSessionsError(null)
    try {
      const res = await fetch('/api/provider', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: nextProvider }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)

      setProvider(nextProvider)
      setSelectedTabKey(null)
      setSelectedProject(null)
      setTargetMessage(null)
      setSessionListScrollRequest(null)
      msgCountRef.current = 0
      setMessages([])
      setLoadingMessages(false)
      setLoadingSessions(true)
      await loadSessionsForProvider(nextProvider, nextScopeMode, nextProjectDir)
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to switch provider')
    } finally {
      setLoadingSessions(false)
      setSwitchingProvider(false)
    }
  }, [activeProjectDir, loadSessionsForProvider, provider, sessionScope, switchingProvider])

  return (
    <CodeThemeProvider>
    <SidebarProvider defaultOpen>
      <div suppressHydrationWarning style={{ display: 'flex', height: '100vh' }}>
        <Sidebar variant="inset">
          <SessionList
            sessions={sessions}
            loading={loadingSessions}
            error={sessionsError}
            provider={provider}
            switchingProvider={switchingProvider}
            selectedId={selectedTabKey}
            selectedProject={selectedProject?.dir ?? null}
            scrollToSessionRequest={sessionListScrollRequest}
            onSelect={selectSession}
            onSelectProject={selectProject}
            onRename={handleRename}
            onTag={handleTag}
            onChangeProvider={handleChangeProvider}
            scopeMode={sessionScope}
            scopeProjectName={activeProjectName}
            canScopeToProject={!!activeProjectDir}
            includeWorktrees={includeWorktrees}
            onChangeScope={setSessionScope}
            onToggleWorktrees={setIncludeWorktrees}
            onOpenCommandPalette={openCommandPalette}
            canOpenGit={!!activeProjectDir}
            onOpenGit={openGitPopover}
            onNewSession={handleNewSession}
            creatingSession={creatingNewSession}
          />
        </Sidebar>
        {messagePaneCollapsed ? (
          <div
            style={{
              width: 32,
              minWidth: 32,
              height: '100vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              paddingTop: 10,
              borderLeft: '1px solid var(--border)',
              background: 'var(--surface)',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={toggleMessagePane}
              title="Expand message pane"
              className="av-hover-control"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-3)',
                padding: '4px 6px',
                borderRadius: 6,
                lineHeight: 1,
                fontSize: 14,
              }}
            >
              ‹
            </button>
          </div>
        ) : (
          <SidebarInset style={{ position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', position: 'relative', flex: 1 }}>
              <button
                type="button"
                onClick={toggleMessagePane}
                title="Collapse message pane"
                className="av-hover-control"
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 8,
                  zIndex: 10,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  color: 'var(--text-3)',
                  padding: '2px 6px',
                  borderRadius: 6,
                  lineHeight: 1,
                  fontSize: 12,
                }}
              >
                ›
              </button>
              <ViewTransition key={messageAreaKey} enter="fade-in" exit="fade-out" default="none">
                <MessageView
                  messages={messages}
                  loading={loadingMessages}
                  session={selectedSession}
                  targetMessageId={targetMessage?.messageId ?? null}
                  targetMessageRequestId={targetMessage?.requestId ?? 0}
                  projectView={projectViewProp}
                  onFork={handleFork}
                  onDelete={handleDelete}
                  openTabs={openTabSessions}
                  selectedTabId={selectedTabKey}
                  onSelectTab={selectOpenTab}
                  onCloseTab={closeTab}
                  taskPanelOpenRequest={taskPanelOpenRequest}
                  openCodeTodos={openCodeTodosForView}
                  codexPlan={codexPlanForView}
                />
              </ViewTransition>
              {commandPaletteOpen ? (
                <CommandPalette
                  open={commandPaletteOpen}
                  onOpenChange={setCommandPaletteOpen}
                  sessions={sessions}
                  selectedSession={selectedSession}
                  selectedProject={selectedProject}
                  provider={provider}
                  scopeMode={sessionScope}
                  scopeProjectName={activeProjectName}
                  includeWorktrees={includeWorktrees}
                  messagePaneCollapsed={messagePaneCollapsed}
                  canOpenGit={!!activeProjectDir}
                  canOpenTasks={!selectedProject && (selectedSession?.provider ?? provider) === 'claude'}
                  onSelectSession={selectCommandPaletteSession}
                  onSelectProject={selectProject}
                  onChangeProvider={handleChangeProvider}
                  onChangeScope={setSessionScope}
                  onToggleWorktrees={setIncludeWorktrees}
                  onToggleMessagePane={toggleMessagePane}
                  onOpenGit={openGitPopover}
                  onOpenTasks={openTaskPanel}
                  onOpenBookmarks={() => setBookmarksPanelOpen(true)}
                />
              ) : null}
            </div>
          </SidebarInset>
        )}
        {activeProjectDir && gitPopoverOpen ? (
          <GitPopover
            open={gitPopoverOpen}
            onClose={() => setGitPopoverOpen(false)}
            cwd={activeProjectDir}
          />
        ) : null}
        {bookmarksPanelOpen ? (
          <BookmarksPanel
            open={bookmarksPanelOpen}
            onClose={() => setBookmarksPanelOpen(false)}
            onSelect={({ sessionId, provider: bookmarkProvider, uuid }) => {
              selectCommandPaletteSession({ sessionId, provider: bookmarkProvider } as Session, uuid)
            }}
          />
        ) : null}
      </div>
    </SidebarProvider>
    </CodeThemeProvider>
  )
}
