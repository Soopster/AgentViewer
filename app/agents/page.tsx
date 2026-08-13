'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Bot, MessageSquare, Radio, RefreshCw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AgentProvider } from '@/lib/types'
import { cn } from '@/lib/utils'

type AddressableSessionSummary = {
  sessionId: string
  provider: AgentProvider
  name: string
  title?: string
  cwd?: string
  running: boolean
}

type DeliveryResult = {
  delivered?: boolean
  mode?: 'steered' | 'queued' | 'not_found' | 'error' | 'throttled'
  targetName?: string
  error?: string
}

function deliveryCopy(result: DeliveryResult): string {
  if (!result.delivered) return result.error || 'The message could not be delivered.'
  return result.mode === 'steered'
    ? `Delivered to ${result.targetName ?? 'the running session'}.`
    : `Started a new turn for ${result.targetName ?? 'the session'}.`
}

export default function AgentsPage() {
  const [sessions, setSessions] = useState<AddressableSessionSummary[]>([])
  const [selectedName, setSelectedName] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const refreshSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/agents', { cache: 'no-store' })
      const data = await response.json() as { sessions?: AddressableSessionSummary[]; error?: string }
      if (!response.ok) throw new Error(data.error || `Session discovery failed with HTTP ${response.status}`)
      const next = data.sessions ?? []
      const requested = new URLSearchParams(window.location.search).get('to')
      setSessions(next)
      setSelectedName((current) => {
        if (next.some((session) => session.name === current)) return current
        if (requested && next.some((session) => session.name === requested)) return requested
        return next[0]?.name ?? ''
      })
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Session discovery failed.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSessions()
    const timer = window.setInterval(() => { void refreshSessions() }, 5_000)
    return () => window.clearInterval(timer)
  }, [refreshSessions])

  useEffect(() => {
    if (!message.trim()) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [message])

  const selectSession = useCallback((name: string) => {
    setSelectedName(name)
    setFeedback(null)
    const url = new URL(window.location.href)
    url.searchParams.set('to', name)
    window.history.replaceState(null, '', url)
  }, [])

  const sendMessage = useCallback(async () => {
    const text = message.trim()
    if (!selectedName || !text || sending) return
    setSending(true)
    setFeedback(null)
    try {
      const response = await fetch('/api/agents/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selectedName, text, fromName: 'Agent Viewer' }),
      })
      const result = await response.json() as DeliveryResult
      if (!response.ok || !result.delivered) throw new Error(result.error || `Delivery failed with HTTP ${response.status}`)
      setMessage('')
      setFeedback({ kind: 'success', text: deliveryCopy(result) })
      void refreshSessions()
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Delivery failed.' })
    } finally {
      setSending(false)
    }
  }, [message, refreshSessions, selectedName, sending])

  const selected = sessions.find((session) => session.name === selectedName)
  const runningCount = sessions.reduce((count, session) => count + Number(session.running), 0)

  return (
    <div className="av-messaging-page">
      <a href="#messaging-workspace" className="sr-only focus:not-sr-only">Skip to Messaging Workspace</a>

      <nav className="av-messaging-nav" aria-label="Cross-session messaging navigation">
        <Button asChild variant="ghost" size="sm" className="av-messaging-back">
          <Link href="/">
            <ArrowLeft data-icon="inline-start" />
            Back to Sessions
          </Link>
        </Button>
        <div className="av-messaging-nav-meta">
          <span><Radio aria-hidden="true" /> Local Transport</span>
          <Button
            variant="outline"
            size="sm"
            className="av-hover-control"
            onClick={() => { setLoading(true); void refreshSessions() }}
            disabled={loading}
          >
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </nav>

      <main id="messaging-workspace" className="av-messaging-workspace">
        <header className="av-messaging-header">
          <div>
            <h1 className="text-balance"><MessageSquare aria-hidden="true" /> Cross-Session Messaging</h1>
            <p>Direct handoffs between running and recently active agent sessions.</p>
          </div>
          <div className="av-messaging-stats" aria-label="Messaging status">
            <span><b>{sessions.length}</b> reachable</span>
            <span className={cn(runningCount > 0 && 'av-live')}><b>{runningCount}</b> running</span>
            <span><b>5</b> providers</span>
            <Button
              variant="outline"
              size="sm"
              className="av-hover-control"
              onClick={() => { setLoading(true); void refreshSessions() }}
              disabled={loading}
            >
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </header>

        <div className="av-messaging-grid">
          <section className="av-messaging-panel" aria-labelledby="reachable-sessions-heading">
            <header className="av-messaging-panel-head">
              <div>
                <span>Destinations</span>
                <h2 id="reachable-sessions-heading">Reachable Sessions</h2>
              </div>
              <small>Last 6 hours</small>
            </header>

            <div className="av-messaging-session-list" role="list" aria-label="Reachable sessions">
              {loading && sessions.length === 0 ? (
                <p className="av-messaging-empty">Looking for sessions…</p>
              ) : sessions.length === 0 ? (
                <p className="av-messaging-empty">No running or recently active sessions found.</p>
              ) : sessions.map((session) => (
                <div key={`${session.provider}:${session.sessionId}`} role="listitem">
                  <button
                    type="button"
                    className={cn('av-messaging-session', selectedName === session.name && 'av-selected')}
                    onClick={() => selectSession(session.name)}
                    aria-pressed={selectedName === session.name}
                  >
                    <span className="av-messaging-session-icon"><Bot aria-hidden="true" /></span>
                    <span className="av-messaging-session-copy">
                      <strong>{session.title || session.name}</strong>
                      <code translate="no">{session.name}</code>
                    </span>
                    <span className="av-messaging-session-meta">
                      <em>{session.provider}</em>
                      <i className={session.running ? 'av-running' : undefined}>{session.running ? 'running' : 'recent'}</i>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="av-messaging-panel av-messaging-compose" aria-labelledby="new-message-heading">
            <header className="av-messaging-panel-head">
              <div>
                <span>Composer</span>
                <h2 id="new-message-heading">New Message</h2>
              </div>
              <small>{selected?.running ? 'Live steer' : 'New turn'}</small>
            </header>

            <form
              id="cross-session-message-form"
              className="av-messaging-form"
              onSubmit={(event) => { event.preventDefault(); void sendMessage() }}
            >
              <div className="av-messaging-recipient">
                <span>To</span>
                {selected ? (
                  <div>
                    <strong>{selected.title || selected.name}</strong>
                    <code translate="no">{selected.name}</code>
                  </div>
                ) : <em>Select a destination session</em>}
              </div>

              <label htmlFor="cross-session-message">Message</label>
              <Textarea
                id="cross-session-message"
                name="message"
                autoComplete="off"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Share a finding, ask a question, or redirect the session…"
                rows={10}
                maxLength={20_000}
                disabled={!selected || sending}
                className="av-messaging-textarea"
              />

              <div className="av-messaging-form-footer">
                <div aria-live="polite">
                  {feedback ? (
                    <p className={cn('av-messaging-feedback', feedback.kind === 'error' ? 'av-error' : 'av-success')}>
                      {feedback.text}
                    </p>
                  ) : (
                    <p>Live sessions receive steering input; idle sessions start a new turn.</p>
                  )}
                </div>
                <Button type="submit" disabled={!selected || !message.trim() || sending}>
                  <Send data-icon="inline-start" aria-hidden="true" />
                  {sending ? 'Sending…' : 'Send Message'}
                </Button>
              </div>
            </form>
          </section>
        </div>

        <footer className="av-messaging-footer">
          <span>Agent Viewer transport</span>
          Provider SDK + HTTP · Windows, macOS, and Linux · no tmux or Unix socket required
        </footer>
      </main>
    </div>
  )
}
