'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import SessionList from '@/components/SessionList'
import MessageView from '@/components/MessageView'
import { CodeThemeProvider } from '@/components/CodeThemeContext'
import type { AgentProvider, Session, SessionMessage } from '@/lib/types'

type SessionScopeMode = 'all' | 'project'

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<{ key: string; sessions: Session[] } | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [provider, setProvider] = useState<AgentProvider>('claude')
  const [switchingProvider, setSwitchingProvider] = useState(false)
  const [sessionScope, setSessionScope] = useState<SessionScopeMode>('all')
  const [includeWorktrees, setIncludeWorktrees] = useState(true)
  // Tracks how many messages we've already loaded so polling can fetch only new ones
  const msgCountRef = useRef(0)
  const selectedSession = sessions.find((s) => s.sessionId === selectedId) ?? null
  const activeProjectDir = selectedProject?.sessions[0]?.cwd ?? selectedSession?.cwd ?? null
  const activeProjectName = activeProjectDir?.split('/').pop() ?? null

  const fetchSessions = useCallback(async () => {
    const params = new URLSearchParams()
    if (sessionScope === 'project' && activeProjectDir) {
      params.set('dir', activeProjectDir)
      params.set('includeWorktrees', String(includeWorktrees))
    }

    const suffix = params.toString() ? `?${params.toString()}` : ''
    const r = await fetch(`/api/sessions${suffix}`)
    const data = await r.json()
    if (data.error) throw new Error(data.error)
    setSessions(data.sessions ?? [])
  }, [activeProjectDir, includeWorktrees, sessionScope])

  const fetchProvider = useCallback(async () => {
    const r = await fetch('/api/provider')
    const data = await r.json()
    if (data.error) throw new Error(data.error)
    setProvider(data.provider === 'codex' ? 'codex' : 'claude')
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
      const nextSessions = sessions.filter((s) => (s.cwd?.split('/').pop() ?? '—') === prev.key)
      if (nextSessions.length === 0) return null
      return { ...prev, sessions: nextSessions }
    })
  }, [sessions])

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

  // Poll active single session for new messages every 2 s (incremental via offset)
  useEffect(() => {
    if (!selectedId || loadingMessages) return
    const id = setInterval(async () => {
      const offset = msgCountRef.current
      try {
        const r = await fetch(`/api/sessions/${selectedId}/messages?offset=${offset}&limit=200`)
        const data = await r.json()
        if (!data.error && data.messages?.length > 0) {
          setMessages((prev) => [...prev, ...data.messages])
        }
      } catch { /* ignore transient errors */ }
    }, 2000)
    return () => clearInterval(id)
  }, [selectedId, loadingMessages])

  // Poll project view every 10 s (full refresh across all sessions)
  useEffect(() => {
    if (!selectedProject) return
    const id = setInterval(async () => {
      try {
        const results = await Promise.all(
          selectedProject.sessions.map((s) =>
            fetch(`/api/sessions/${s.sessionId}/messages`).then((r) => r.json())
          )
        )
        const all = results.flatMap((d) => d.messages ?? []) as SessionMessage[]
        all.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''))
        setMessages(all)
      } catch { /* ignore transient errors */ }
    }, 10_000)
    return () => clearInterval(id)
  }, [selectedProject])

  async function selectSession(sessionId: string) {
    setSelectedId(sessionId)
    setSelectedProject(null)
    setLoadingMessages(true)
    setMessages([])
    try {
      const r = await fetch(`/api/sessions/${sessionId}/messages`)
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setMessages(data.messages ?? [])
    } catch (err) {
      console.error('Failed to load messages:', err)
    } finally {
      setLoadingMessages(false)
    }
  }

  async function selectProject(key: string, projectSessions: Session[]) {
    setSelectedProject({ key, sessions: projectSessions })
    setSelectedId(null)
    setLoadingMessages(true)
    setMessages([])
    try {
      const results = await Promise.all(
        projectSessions.map((s) =>
          fetch(`/api/sessions/${s.sessionId}/messages`).then((r) => r.json())
        )
      )
      const all = results.flatMap((d) => d.messages ?? []) as SessionMessage[]
      all.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''))
      setMessages(all)
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
    // The new session will appear in the next poll cycle; select it immediately
    selectSession(newSessionId)
  }, [])

  const handleChangeProvider = useCallback(async (nextProvider: AgentProvider) => {
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
      setSessionScope('all')
      setMessages([])
      setLoadingMessages(false)
      setLoadingSessions(true)
      const resessions = await fetch('/api/sessions')
      const sessionData = await resessions.json()
      if (!resessions.ok || sessionData.error) throw new Error(sessionData.error ?? `HTTP ${resessions.status}`)
      setSessions(sessionData.sessions ?? [])
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to switch provider')
    } finally {
      setLoadingSessions(false)
      setSwitchingProvider(false)
    }
  }, [fetchSessions, provider, switchingProvider])

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
        selectedProject={selectedProject?.key ?? null}
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
        projectView={selectedProject ? { key: selectedProject.key, sessionCount: selectedProject.sessions.length } : undefined}
        onFork={handleFork}
      />
    </div>
    </CodeThemeProvider>
  )
}
