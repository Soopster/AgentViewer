'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import SessionList from '@/components/SessionList'
import MessageView from '@/components/MessageView'
import { CodeThemeProvider } from '@/components/CodeThemeContext'
import { isProviderSelection } from '@/lib/provider'
import { pathBasename, sameProjectPath } from '@/lib/projectPaths'
import type { AgentProvider, ProviderSelection, Session, SessionMessage } from '@/lib/types'

type SessionScopeMode = 'all' | 'project'
type ProjectSelection = {
  key: string
  dir: string
  sessions: Session[]
}

type ProjectMessageBatch = {
  key: string
  sessionId: string
  provider?: AgentProvider
  offset: number
  messages: SessionMessage[]
}

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

  const existingByKey = new Map(existing.map((message) => [sessionMessageKey(message), message] as const))
  const latestIncomingByKey = new Map<string, SessionMessage>()
  for (const message of incoming) latestIncomingByKey.set(sessionMessageKey(message), message)

  let changed = false
  const replacements = new Map<string, SessionMessage>()

  for (const [key, message] of latestIncomingByKey) {
    const previous = existingByKey.get(key)
    if (previous && apiMessageSignature(previous) === apiMessageSignature(message)) continue
    replacements.set(key, message)
    changed = true
  }

  if (!changed) return existing

  const retained = existing.filter((message) => !replacements.has(sessionMessageKey(message)))
  const additions = [...replacements.values()].sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b))
  return mergeSortedMessages(retained, additions)
}

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<ProjectSelection | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [provider, setProvider] = useState<ProviderSelection>('claude')
  const [switchingProvider, setSwitchingProvider] = useState(false)
  const [sessionScope, setSessionScope] = useState<SessionScopeMode>('all')
  const [includeWorktrees, setIncludeWorktrees] = useState(true)
  // Tracks how many messages we've already loaded so polling can fetch only new ones
  const msgCountRef = useRef(0)
  const projectMessageCountsRef = useRef<Map<string, number>>(new Map())
  // Guards to prevent concurrent poll ticks from overlapping when a fetch takes > interval
  const pollInFlightRef = useRef(false)
  const projectPollInFlightRef = useRef(false)
  const selectedSession = sessions.find((s) => s.sessionId === selectedId) ?? null
  const activeProjectDir = selectedProject?.dir ?? selectedSession?.cwd ?? null
  const activeProjectName = selectedProject?.key ?? (pathBasename(activeProjectDir) || null)

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

  const fetchSessionMessages = useCallback(async (session: Session) => {
    const response = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}/messages?limit=2000`, session.provider))
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
    return (data.messages ?? []) as SessionMessage[]
  }, [])

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
        initialLimit: 2000,
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

  const fetchSessions = useCallback(async () => {
    if (sessionScope === 'project' && activeProjectDir) {
      const loaded = await fetchProjectSessions(activeProjectDir, provider)
      setSessions(loaded)
      return
    }

    const params = new URLSearchParams()
    if (provider === 'all') {
      params.set('provider', 'all')
      params.set('limit', '500')
    }
    const suffix = params.toString() ? `?${params.toString()}` : ''
    const r = await fetch(`/api/sessions${suffix}`)
    const data = await r.json()
    if (data.error) throw new Error(data.error)
    setSessions((data.sessions ?? []) as Session[])
  }, [activeProjectDir, fetchProjectSessions, provider, sessionScope])

  const fetchProvider = useCallback(async () => {
    const r = await fetch('/api/provider')
    const data = await r.json()
    if (data.error) throw new Error(data.error)
    setProvider(isProviderSelection(data.provider) ? data.provider : 'claude')
  }, [])

  // Keep ref in sync with state (avoids stale closures inside setInterval)
  useEffect(() => { msgCountRef.current = messages.length }, [messages.length])

  // Initial session load
  useEffect(() => {
    Promise.all([fetchProvider(), fetchSessions()])
      .catch((err) => setSessionsError(err.message))
      .finally(() => setLoadingSessions(false))
  }, [fetchProvider, fetchSessions])

  // Poll sessions list silently every 5 s
  useEffect(() => {
    const id = setInterval(() => {
      fetchSessions()
        .catch(() => {})
    }, 5000)
    return () => clearInterval(id)
  }, [fetchSessions])

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
    if (!selectedId) return
    if (sessions.some((s) => s.sessionId === selectedId)) return
    setSelectedId(null)
    setMessages([])
  }, [selectedId, sessions])

  useEffect(() => {
    if (selectedProject) return
    projectMessageCountsRef.current.clear()
  }, [selectedProject])

  // Poll active single session for new messages every 2 s (incremental via offset)
  useEffect(() => {
    if (!selectedId || loadingMessages) return
    const id = setInterval(async () => {
      if (pollInFlightRef.current) return
      pollInFlightRef.current = true
      const offset = msgCountRef.current
      try {
        const r = await fetch(withProviderQuery(`/api/sessions/${selectedId}/messages?offset=${offset}&limit=200`, selectedSession?.provider))
        const data = await r.json()
        if (!data.error && data.messages?.length > 0) {
          setMessages((prev) => mergeMessages(prev, data.messages as SessionMessage[]))
        }
      } catch { /* ignore transient errors */ } finally {
        pollInFlightRef.current = false
      }
    }, 2000)
    return () => clearInterval(id)
  }, [loadingMessages, selectedId, selectedSession?.provider])

  // Poll project view every 2 s using per-session incremental fetches.
  useEffect(() => {
    if (!selectedProject) return
    const id = setInterval(async () => {
      if (projectPollInFlightRef.current) return
      projectPollInFlightRef.current = true
      try {
        const offsets = Object.fromEntries(projectMessageCountsRef.current.entries())
        const { sessions: projectSessions, batches } = await fetchProjectMessageBatches(selectedProject.dir, provider, offsets)
        for (const batch of batches) {
          projectMessageCountsRef.current.set(batch.key, batch.offset + batch.messages.length)
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

  async function selectSession(session: Session) {
    setSelectedId(session.sessionId)
    setSelectedProject(null)
    projectMessageCountsRef.current.clear()
    setLoadingMessages(true)
    setMessages([])
    try {
      const loadedMessages = await fetchSessionMessages(session)
      setMessages(loadedMessages)
    } catch (err) {
      console.error('Failed to load messages:', err)
    } finally {
      setLoadingMessages(false)
    }
  }

  async function selectProject(projectDir: string, projectName: string, projectSessions: Session[]) {
    setSelectedProject({ key: projectName, dir: projectDir, sessions: projectSessions })
    setSelectedId(null)
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
  }

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

  const handleChangeProvider = useCallback(async (nextProvider: ProviderSelection) => {
    if (nextProvider === provider || switchingProvider) return
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
      setSelectedId(null)
      setSelectedProject(null)
      setMessages([])
      setLoadingMessages(false)
      setLoadingSessions(true)
      if (sessionScope === 'project' && activeProjectDir) {
        const loaded = await fetchProjectSessions(activeProjectDir, nextProvider)
        setSessions(loaded)
        return
      }
      const params = new URLSearchParams()
      if (nextProvider === 'all') {
        params.set('provider', 'all')
        params.set('limit', '500')
      }
      const suffix = params.toString() ? `?${params.toString()}` : ''
      const resessions = await fetch(`/api/sessions${suffix}`)
      const sessionData = await resessions.json()
      if (!resessions.ok || sessionData.error) throw new Error(sessionData.error ?? `HTTP ${resessions.status}`)
      setSessions((sessionData.sessions ?? []) as Session[])
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to switch provider')
    } finally {
      setLoadingSessions(false)
      setSwitchingProvider(false)
    }
  }, [activeProjectDir, fetchProjectSessions, provider, sessionScope, switchingProvider])

  return (
    <CodeThemeProvider>
    <div style={{ display: 'flex', height: '100vh' }}>
      <SessionList
        sessions={sessions}
        loading={loadingSessions}
        error={sessionsError}
        provider={provider}
        switchingProvider={switchingProvider}
        selectedId={selectedId}
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
      />
      <MessageView
        messages={messages}
        loading={loadingMessages}
        session={selectedSession}
        projectView={selectedProject ? { key: selectedProject.key, sessionCount: selectedProject.sessions.length, providerMode: provider === 'all' ? 'all' : 'current' } : undefined}
        onFork={handleFork}
      />
    </div>
    </CodeThemeProvider>
  )
}
