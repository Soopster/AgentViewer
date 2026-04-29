'use client'

import { useState, useEffect, useRef, useCallback, startTransition, ViewTransition } from 'react'
import dynamic from 'next/dynamic'
import SessionList from '@/components/SessionList'
import MessageView from '@/components/MessageView'
import { CodeThemeProvider } from '@/components/CodeThemeContext'
import { Sidebar, SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { isProviderSelection } from '@/lib/provider'
import { pathBasename, sameProjectPath } from '@/lib/projectPaths'
import type { AgentProvider, ProviderSelection, Session, SessionMessage } from '@/lib/types'

const CommandPalette = dynamic(() => import('@/components/CommandPalette'), { ssr: false })
const GitPopover = dynamic(() => import('@/components/GitPopover'), { ssr: false })

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

type ProjectMessageBatch = {
  key: string
  sessionId: string
  provider?: AgentProvider
  offset: number
  messages: SessionMessage[]
}

const MESSAGE_POLL_BACKFILL = 20

function withProviderQuery(path: string, provider?: AgentProvider | 'all'): string {
  if (!provider) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}provider=${provider}`
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

function projectSessionKey(session: Pick<Session, 'sessionId' | 'provider'>): string {
  return `${session.provider ?? 'claude'}:${session.sessionId}`
}

function sessionsFingerprint(sessions: Session[]): string {
  return sessions.map((s) => `${s.provider ?? 'claude'}:${s.sessionId}:${s.lastModified ?? s.createdAt ?? ''}`).join('|')
}

function apiMessageSignature(message: SessionMessage): string {
  const originKind = message.origin?.kind ?? ''
  const turnId = message.turnId ?? ''
  const timestamp = message.timestamp ?? ''
  let payload = ''
  try {
    payload = JSON.stringify(message.message)
  } catch {
    payload = String(message.message)
  }
  return [message.type, timestamp, originKind, turnId, payload].join('|')
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

export default function Home() {
  const [messagePaneCollapsed, setMessagePaneCollapsed] = useState(
    () => typeof document !== 'undefined' && document.documentElement.dataset.msgPane === 'collapsed'
  )
  const [sessions, setSessions] = useState<Session[]>([])
  const [openTabSessions, setOpenTabSessions] = useState<Session[]>([])
  const [selectedTabKey, setSelectedTabKey] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<ProjectSelection | null>(null)
  const [targetMessage, setTargetMessage] = useState<MessageTarget | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderSelection>('claude')
  const [switchingProvider, setSwitchingProvider] = useState(false)
  const [sessionScope, setSessionScope] = useState<SessionScopeMode>('all')
  const [includeWorktrees, setIncludeWorktrees] = useState(true)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [gitPopoverOpen, setGitPopoverOpen] = useState(false)
  // Tracks how many messages we've already loaded so polling can fetch only new ones
  const msgCountRef = useRef(0)
  const projectMessageCountsRef = useRef<Map<string, number>>(new Map())
  // Guards to prevent concurrent poll ticks from overlapping when a fetch takes > interval
  const pollInFlightRef = useRef(false)
  const projectPollInFlightRef = useRef(false)
  const sessionsFingerprintRef = useRef('')
  const targetMessageRequestRef = useRef(0)
  const selectedSession =
    openTabSessions.find((s) => projectSessionKey(s) === selectedTabKey) ??
    sessions.find((s) => projectSessionKey(s) === selectedTabKey) ??
    null
  const activeProjectDir = selectedProject?.dir ?? selectedSession?.cwd ?? null
  const activeProjectName = selectedProject?.key ?? (pathBasename(activeProjectDir) || null)
  const messageAreaKey = selectedTabKey ?? (selectedProject ? `proj:${selectedProject.dir}` : '')

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

  const fetchSessionMessages = useCallback(async (session: Session, targetMessageId?: string) => {
    const query = targetMessageId
      ? 'limit=100000&all=1'
      : 'limit=2000&tail=1'
    const response = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}/messages?${query}`, session.provider))
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
    return (data.messages ?? []) as SessionMessage[]
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
        startTransition(() => { setSessions(loaded) })
      }
      return
    }

    const params = new URLSearchParams()
    params.set('provider', selection)
    params.set('limit', '500')
    const suffix = params.toString() ? `?${params.toString()}` : ''
    const r = await fetch(`/api/sessions${suffix}`)
    const data = await r.json()
    if (data.error) throw new Error(data.error)
    const loaded = (data.sessions ?? []) as Session[]
    const fp = sessionsFingerprint(loaded)
    if (fp !== sessionsFingerprintRef.current) {
      sessionsFingerprintRef.current = fp
      startTransition(() => { setSessions(loaded) })
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

  // Keep ref in sync with state (avoids stale closures inside setInterval)
  useEffect(() => { msgCountRef.current = messages.length }, [messages.length])

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

  // Poll sessions list silently every 5 s
  useEffect(() => {
    const id = setInterval(() => {
      fetchSessions()
        .catch(() => {})
    }, 5000)
    return () => clearInterval(id)
  }, [fetchSessions])

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
    setMessages([])
  }, [openTabSessions, selectedTabKey, sessions])

  useEffect(() => {
    if (selectedProject) return
    projectMessageCountsRef.current.clear()
  }, [selectedProject])

  // Poll active single session for new messages every 2 s (incremental via offset)
  useEffect(() => {
    if (!selectedSession || loadingMessages) return
    const id = setInterval(async () => {
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
      const offset = Math.max(0, msgCountRef.current - MESSAGE_POLL_BACKFILL)
      try {
        const r = await fetch(withProviderQuery(`/api/sessions/${selectedSession.sessionId}/messages?offset=${offset}&limit=${200 + MESSAGE_POLL_BACKFILL}`, selectedSession.provider))
        const data = await r.json()
        if (!data.error && data.messages?.length > 0) {
          setMessages((prev) => mergeMessages(prev, data.messages as SessionMessage[]))
        }
      } catch { /* ignore transient errors */ } finally {
        pollInFlightRef.current = false
      }
    }, 2000)
    return () => clearInterval(id)
  }, [loadingMessages, selectedSession])

  // Poll project view every 2 s using per-session incremental fetches.
  useEffect(() => {
    if (!selectedProject) return
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
          setMessages((prev) => mergeMessages(prev, incoming))
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
  }, [fetchProjectMessageBatches, provider, selectedProject])

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
        const alreadyOpen = prev.some(
          (s) => projectSessionKey(s) === projectSessionKey(session),
        )
        return alreadyOpen ? prev : [...prev, session]
      })
      setSelectedTabKey(projectSessionKey(session))
      setSelectedProject(null)
      setTargetMessage(nextTargetMessageId
        ? { messageId: nextTargetMessageId, requestId: ++targetMessageRequestRef.current }
        : null
      )
    })
    projectMessageCountsRef.current.clear()
    setLoadingMessages(true)
    setMessages([])
    try {
      const loadedMessages = await fetchSessionMessages(session, nextTargetMessageId)
      setMessages(loadedMessages)
    } catch (err) {
      console.error('Failed to load messages:', err)
    } finally {
      setLoadingMessages(false)
    }
  }, [fetchSessionMessages, provider, loadSessionsForProvider])

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
      setMessages(all)
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

  // Navigate to a newly forked session
  const handleFork = useCallback((newSessionId: string) => {
    if (!selectedSession?.provider) return
    void selectSession({ sessionId: newSessionId, provider: selectedSession.provider } as Session)
  }, [selectedSession?.provider])

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
      setMessages([])
    }
  }, [openTabSessions, selectedTabKey])

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
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            canOpenGit={!!activeProjectDir}
            onOpenGit={openGitPopover}
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
                  projectView={selectedProject ? { key: selectedProject.key, sessionCount: selectedProject.sessions.length, providerMode: provider === 'all' ? 'all' : 'current' } : undefined}
                  onFork={handleFork}
                  onDelete={handleDelete}
                  openTabs={openTabSessions}
                  selectedTabId={selectedTabKey}
                  onSelectTab={(s) => void selectSession(s)}
                  onCloseTab={closeTab}
                />
              </ViewTransition>
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
                onSelectSession={selectSession}
                onSelectProject={selectProject}
                onChangeProvider={handleChangeProvider}
                onChangeScope={setSessionScope}
                onToggleWorktrees={setIncludeWorktrees}
                onToggleMessagePane={toggleMessagePane}
                onOpenGit={openGitPopover}
              />
            </div>
          </SidebarInset>
        )}
        {activeProjectDir ? (
          <GitPopover
            open={gitPopoverOpen}
            onClose={() => setGitPopoverOpen(false)}
            cwd={activeProjectDir}
          />
        ) : null}
      </div>
    </SidebarProvider>
    </CodeThemeProvider>
  )
}
