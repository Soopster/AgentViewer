import { Bot, MessageSquare, RefreshCw, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { MessagingWorkspaceModel } from './types'

export function MessagingWorkspace({ messaging }: { messaging: MessagingWorkspaceModel }) {
  const { sessions, selectedSessionId, message, setMessage, loading, sending, feedback, refresh, selectSession, sendMessage } = messaging
  const selected = sessions.find(session => session.sessionId === selectedSessionId)
  const runningCount = sessions.reduce((count, session) => count + Number(session.running), 0)
  return (
  <div id="messaging-workspace" className="av-messaging-workspace">
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
          onClick={() => { void refresh() }}
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
                className={cn('av-hover-control av-messaging-session', selectedSessionId === session.sessionId && 'av-selected')}
                onClick={() => selectSession(session.sessionId)}
                aria-pressed={selectedSessionId === session.sessionId}
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
  </div>
  )
}
