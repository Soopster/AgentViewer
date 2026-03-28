'use client'

import type { SessionMessage, Session } from '@/lib/types'
import { buildThreadedMessages } from '@/lib/threading'
import MessageItem from './MessageItem'

type Props = {
  messages: SessionMessage[]
  loading: boolean
  session: Session | null
}

export default function MessageView({ messages, loading, session }: Props) {
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
    </div>
  )
}
