'use client'

import { useState, useEffect, useRef } from 'react'
import SessionList from '@/components/SessionList'
import MessageView from '@/components/MessageView'
import type { Session, SessionMessage } from '@/lib/types'

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  // Tracks how many messages we've already loaded so polling can fetch only new ones
  const msgCountRef = useRef(0)

  // Keep ref in sync with state (avoids stale closures inside setInterval)
  useEffect(() => { msgCountRef.current = messages.length }, [messages.length])

  // Initial session load
  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error)
        setSessions(data.sessions ?? [])
      })
      .catch((err) => setSessionsError(err.message))
      .finally(() => setLoadingSessions(false))
  }, [])

  // Poll sessions list silently every 5 s
  useEffect(() => {
    const id = setInterval(() => {
      fetch('/api/sessions')
        .then((r) => r.json())
        .then((data) => { if (!data.error) setSessions(data.sessions ?? []) })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(id)
  }, [])

  // Poll active session for new messages every 2 s (incremental via offset)
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

  async function selectSession(sessionId: string) {
    setSelectedId(sessionId)
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

  const selectedSession = sessions.find((s) => s.sessionId === selectedId)

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <SessionList
        sessions={sessions}
        loading={loadingSessions}
        error={sessionsError}
        selectedId={selectedId}
        onSelect={selectSession}
      />
      <MessageView
        messages={messages}
        loading={loadingMessages}
        session={selectedSession ?? null}
      />
    </div>
  )
}
