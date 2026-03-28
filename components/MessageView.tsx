'use client'

import { useState, useRef, useCallback } from 'react'
import type { SessionMessage, Session, SendState } from '@/lib/types'
import { buildThreadedMessages } from '@/lib/threading'
import { exportSessionToHtml, downloadHtml } from '@/lib/export'
import MessageItem from './MessageItem'

type Props = {
  messages: SessionMessage[]
  loading: boolean
  session: Session | null
}

export default function MessageView({ messages, loading, session }: Props) {
  const [inputText, setInputText] = useState('')
  const [sendState, setSendState] = useState<SendState>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // TODO: Implement this function.
  // It should POST `inputText` to `/api/sessions/${session.sessionId}/messages`
  // and drain the SSE response while Claude processes the message.
  //
  // The response is an SSE stream — you can drain it with a ReadableStream reader.
  // New messages will appear automatically via the 2s polling, so you don't need
  // to parse the SSE events; just wait for the stream to end.
  //
  // Constraints to consider:
  //   - Clear inputText before or after sending?
  //   - What should happen to sendState on error vs success?
  //   - Should the textarea auto-focus again after send?
  //
  // State available: setSendState('sending' | 'idle' | 'error'), setSendError(msg)
  const sendMessage = useCallback(async () => {
    if (!session || !inputText.trim() || sendState === 'sending') return

    const text = inputText.trim()
    setInputText('')
    setSendState('sending')
    setSendError(null)

    // Reset textarea height after clearing
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        // Surface server-side errors emitted as SSE error events
        if (chunk.includes('event: error')) {
          const dataLine = chunk.split('\n').find(l => l.startsWith('data:'))
          if (dataLine) {
            const parsed = JSON.parse(dataLine.slice(5).trim())
            throw new Error(parsed.error ?? 'Unknown error from Claude')
          }
        }
      }

      setSendState('idle')
      textareaRef.current?.focus()
    } catch (err) {
      setSendState('error')
      setSendError(err instanceof Error ? err.message : 'Failed to send message')
      // Restore the text so the user can retry
      setInputText(text)
    }
  }, [session, inputText, sendState])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      sendMessage()
    }
  }, [sendMessage])

  const handleExport = useCallback(() => {
    if (!session) return
    const dirName  = session.tag ?? session.cwd?.split('/').pop() ?? session.sessionId
    const safeName = dirName.replace(/[^a-z0-9\-_]/gi, '-').toLowerCase()
    const html = exportSessionToHtml(session, messages)
    downloadHtml(html, `${safeName}_${session.sessionId.slice(0, 8)}.html`)
  }, [session, messages])

  if (!session) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {/* Decorative orbital ring */}
        <div style={{ position: 'relative', width: 72, height: 72 }}>
          {/* Outer dashed orbit */}
          <div style={{
            position: 'absolute',
            inset: -10,
            borderRadius: '50%',
            border: '1px dashed var(--border)',
            animation: 'orbit-spin 18s linear infinite',
          }}>
            {/* Orbiting dot */}
            <div style={{
              position: 'absolute',
              top: -3, left: '50%',
              width: 5, height: 5,
              borderRadius: '50%',
              background: 'var(--violet)',
              transform: 'translateX(-50%)',
              boxShadow: '0 0 6px 2px var(--violet-glow)',
            }} />
          </div>
          {/* Inner circle */}
          <div style={{
            width: 72, height: 72,
            borderRadius: '50%',
            border: '1px solid var(--border-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, var(--surface-2), var(--surface))',
            boxShadow: '0 0 40px 8px rgba(139,128,240,0.04) inset',
          }}>
            <div style={{
              width: 18, height: 18,
              borderRadius: '50%',
              background: 'var(--surface-3)',
              border: '1px solid var(--border-2)',
              boxShadow: '0 0 8px 2px rgba(139,128,240,0.06)',
            }} />
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: "'Oxanium', monospace",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-3)',
            marginBottom: 8,
          }}>
            No session selected
          </div>
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: 'var(--text-3)',
            letterSpacing: '0.03em',
          }}>
            ← Choose a session from the sidebar
          </div>
        </div>
      </div>
    )
  }

  const threaded = buildThreadedMessages(messages)
  const dirName  = session.cwd?.split('/').pop() ?? session.sessionId

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      {/* ── Top bar ──────────────────────────────────── */}
      <div
        style={{
          padding: '0 28px',
          height: 52,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'linear-gradient(to right, rgba(139,128,240,0.05) 0%, var(--surface) 40%)',
        }}
      >
        {/* Project name */}
        <span
          style={{
            fontFamily: "'Oxanium', monospace",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--text)',
            textTransform: 'uppercase',
          }}
        >
          {dirName}
        </span>

        {/* Path */}
        {session.cwd && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {session.cwd}
          </span>
        )}

        {/* Stats */}
        {!loading && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--text-3)',
              flexShrink: 0,
            }}
          >
            {threaded.length} turns · {messages.length} events
          </span>
        )}

        {/* Export button */}
        <button
          onClick={handleExport}
          title="Export session to HTML"
          style={{
            flexShrink: 0,
            height: 26,
            padding: '0 10px',
            background: 'rgba(56,217,245,0.07)',
            border: '1px solid rgba(56,217,245,0.18)',
            borderRadius: 5,
            cursor: 'pointer',
            color: 'var(--text-3)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.08em',
            transition: 'background 0.15s, color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background    = 'rgba(56,217,245,0.13)'
            e.currentTarget.style.color         = 'var(--cyan)'
            e.currentTarget.style.borderColor   = 'rgba(56,217,245,0.35)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background    = 'rgba(56,217,245,0.07)'
            e.currentTarget.style.color         = 'var(--text-3)'
            e.currentTarget.style.borderColor   = 'rgba(56,217,245,0.18)'
          }}
        >
          EXPORT
        </button>

        {/* Live pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'rgba(45, 212, 160, 0.08)',
            border: '1px solid rgba(45, 212, 160, 0.2)',
            borderRadius: 20,
            padding: '2px 8px 2px 6px',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: 'var(--green)',
              display: 'inline-block',
              animation: 'live-pulse 2.5s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11,
              color: 'var(--green)',
              letterSpacing: '0.08em',
            }}
          >
            LIVE
          </span>
        </div>
      </div>

      {/* ── Timeline feed ────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '28px 32px 72px',
        }}
      >
        {loading && (
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12,
              color: 'var(--text-3)',
              letterSpacing: '0.04em',
            }}
          >
            Loading…
          </div>
        )}
        {!loading && threaded.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No messages.</div>
        )}
        {!loading && threaded.length > 0 && (
          <div style={{ position: 'relative' }}>
            {/* Continuous timeline track */}
            <div
              style={{
                position: 'absolute',
                left: 9,
                top: 10,
                bottom: 0,
                width: 1,
                background: 'linear-gradient(to bottom, var(--border-2) 0%, var(--border) 60%, transparent 100%)',
                pointerEvents: 'none',
              }}
            />
            {threaded.map((msg, i) => (
              <div
                key={msg.uuid}
                style={{
                  animation: 'fade-up 0.28s ease both',
                  animationDelay: `${Math.min(i * 16, 320)}ms`,
                }}
              >
                <MessageItem message={msg} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Message input ─────────────────────────────── */}
      <div
        style={{
          padding: '12px 20px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        {sendError && (
          <div style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11,
            color: 'var(--red, #f87171)',
            marginBottom: 8,
            letterSpacing: '0.03em',
          }}>
            {sendError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={e => {
              setInputText(e.target.value)
              if (sendError) setSendError(null)
              // Auto-resize
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 96)}px`
            }}
            onKeyDown={handleKeyDown}
            disabled={sendState === 'sending'}
            placeholder="Send a message… (⌘↩ to send)"
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              background: 'var(--surface-2)',
              border: `1px solid ${sendState === 'error' ? 'rgba(248,113,113,0.4)' : 'var(--border-2)'}`,
              borderRadius: 6,
              padding: '8px 12px',
              fontFamily: "'IBM Plex Sans', sans-serif",
              fontSize: 13,
              color: 'var(--text)',
              lineHeight: 1.5,
              outline: 'none',
              overflow: 'hidden',
              opacity: sendState === 'sending' ? 0.5 : 1,
              transition: 'border-color 0.15s, opacity 0.15s',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={sendState === 'sending' || !inputText.trim()}
            style={{
              flexShrink: 0,
              height: 36,
              padding: '0 14px',
              background: sendState === 'sending'
                ? 'rgba(139,128,240,0.15)'
                : 'rgba(139,128,240,0.18)',
              border: '1px solid rgba(139,128,240,0.3)',
              borderRadius: 6,
              color: sendState === 'sending' ? 'var(--text-3)' : 'var(--violet)',
              fontFamily: "'Oxanium', monospace",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.1em',
              cursor: sendState === 'sending' || !inputText.trim() ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s, color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {sendState === 'sending' ? 'SENDING…' : 'SEND'}
          </button>
        </div>
      </div>
    </div>
  )
}
