'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import SessionList from '@/components/SessionList'
import MessageView from '@/components/MessageView'
import { CodeThemeProvider } from '@/components/CodeThemeContext'
import { sameProjectPath } from '@/lib/projectPaths'
import type { AgentProvider, ProviderSelection, Session, SessionMessage } from '@/lib/types'

type SessionScopeMode = 'all' | 'project'
type ProjectSelection = {
  key: string
  dir: string
  sessions: Session[]
}

const ALL_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'opencode']

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

function mergeMessages(existing: SessionMessage[], incoming: SessionMessage[]): SessionMessage[] {
  if (incoming.length === 0) return existing
  const deduped = new Map<string, SessionMessage>()
  for (const message of existing) deduped.set(sessionMessageKey(message), message)
  for (const message of incoming) deduped.set(sessionMessageKey(message), message)
  return [...deduped.values()].sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b))
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
  const selectedSession = sessions.find((s) => s.sessionId === selectedId) ?? null
  const activeProjectDir = selectedProject?.dir ?? selectedSession?.cwd ?? null
  const activeProjectName = selectedProject?.key ?? activeProjectDir?.split('/').pop() ?? null

  const fetchAllProviderProjectSessions = useCallback(async (dir: string) => {
    const results = await Promise.all(
      ALL_PROVIDERS.map(async (providerName) => {
        const params = new URLSearchParams()
        params.set('provider', providerName)
        params.set('limit', '500')
        params.set('includeWorktrees', String(includeWorktrees))
        const response = await fetch(`/api/sessions?${params.toString()}`)
        const data = await response.json()
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
        const loaded = (data.sessions ?? []) as Session[]
        return loaded.filter((session) => sameProjectPath(dir, session.cwd))
      })
    )

    const deduped = new Map<string, Session>()
    for (const session of results.flat()) {
      deduped.set(`${session.provider}:${session.sessionId}`, session)
    }

    return [...deduped.values()].sort((a, b) => {
      const aTime = Number(a.lastModified ?? a.createdAt ?? 0)
      const bTime = Number(b.lastModified ?? b.createdAt ?? 0)
      return bTime - aTime
    })
  }, [includeWorktrees])

  const fetchProjectSessions = useCallback(async (dir: string, selection: ProviderSelection) => {
    if (selection === 'all') {
      return fetchAllProviderProjectSessions(dir)
    }

    const params = new URLSearchParams()
    params.set('dir', dir)
    params.set('includeWorktrees', String(includeWorktrees))
    params.set('limit', '500')
    const response = await fetch(`/api/sessions?${params.toString()}`)
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
    return (data.sessions ?? []) as Session[]
  }, [fetchAllProviderProjectSessions, includeWorktrees])

  const fetchSessionMessages = useCallback(async (session: Session) => {
    const response = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}/messages?limit=2000`, session.provider))
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
    return (data.messages ?? []) as SessionMessage[]
  }, [])

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
    setProvider(data.provider === 'all' || data.provider === 'codex' || data.provider === 'opencode' ? data.provider : 'claude')
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
      const offset = msgCountRef.current
      try {
        const r = await fetch(withProviderQuery(`/api/sessions/${selectedId}/messages?offset=${offset}&limit=200`, selectedSession?.provider))
        const data = await r.json()
        if (!data.error && data.messages?.length > 0) {
          setMessages((prev) => [...prev, ...data.messages])
        }
      } catch { /* ignore transient errors */ }
    }, 2000)
    return () => clearInterval(id)
  }, [loadingMessages, selectedId, selectedSession?.provider])

  // Poll project view every 2 s using per-session incremental fetches.
  useEffect(() => {
    if (!selectedProject) return
    const id = setInterval(async () => {
      try {
        const projectSessions = await fetchProjectSessions(selectedProject.dir, provider)
        const results = await Promise.all(
          projectSessions.map(async (session) => {
            const key = projectSessionKey(session)
            const offset = projectMessageCountsRef.current.get(key) ?? 0
            const limit = offset === 0 ? 2000 : 200
            const response = await fetch(withProviderQuery(`/api/sessions/${session.sessionId}/messages?offset=${offset}&limit=${limit}`, session.provider))
            const data = await response.json()
            if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`)
            return {
              key,
              offset,
              messages: (data.messages ?? []) as SessionMessage[],
            }
          })
        )
        for (const result of results) {
          projectMessageCountsRef.current.set(result.key, result.offset + result.messages.length)
        }
        const incoming = results.flatMap((result) => result.messages)
        if (incoming.length > 0) {
          setMessages((prev) => mergeMessages(prev, incoming))
        }
        setSelectedProject((prev) => prev && prev.dir === selectedProject.dir
          ? { ...prev, sessions: projectSessions }
          : prev
        )
      } catch { /* ignore transient errors */ }
    }, 2000)
    return () => clearInterval(id)
  }, [fetchProjectSessions, provider, selectedProject])

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
      const sessionsForProject = provider === 'all'
        ? await fetchProjectSessions(projectDir, 'all')
        : projectSessions
      const results = await Promise.all(
        sessionsForProject.map((session) => fetchSessionMessages(session))
      )
      const all = results.flat() as SessionMessage[]
      all.sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b))
      projectMessageCountsRef.current = new Map(
        sessionsForProject.map((session, index) => [projectSessionKey(session), results[index]?.length ?? 0])
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
