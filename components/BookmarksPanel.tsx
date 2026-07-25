'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, RefreshCw, Trash2, X } from 'lucide-react'
import type { AgentProvider } from '@/lib/types'
import type { MessageBookmark } from '@/lib/messageBookmarks'

type Props = {
  open: boolean
  onClose: () => void
  onSelect: (target: { sessionId: string; provider: AgentProvider; uuid: string }) => void
}

const PROVIDER_META: Record<AgentProvider, { label: string; color: string }> = {
  claude: { label: 'Claude', color: '#d97757' },
  codex: { label: 'Codex', color: '#10a37f' },
  opencode: { label: 'OpenCode', color: '#f59e0b' },
  copilot: { label: 'Copilot', color: '#8b5cf6' },
  pi: { label: 'Pi', color: '#ec4899' },
}

function timeAgo(value?: number): string {
  if (value == null) return ''
  const ms = Date.now() - value
  if (ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function BookmarksPanel({ open, onClose, onSelect }: Props) {
  const [bookmarks, setBookmarks] = useState<MessageBookmark[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const cursorRef = useRef(0)

  useEffect(() => {
    cursorRef.current = cursor
  }, [cursor])

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch('/api/bookmarks')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.bookmarks)) setBookmarks(data.bookmarks as MessageBookmark[])
        else setError(data?.error ?? 'Failed to load bookmarks')
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load bookmarks'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!open) return
    setCursor(0)
    load()
  }, [open, load])

  const handleSelect = useCallback((bookmark: MessageBookmark) => {
    onSelect({ sessionId: bookmark.sessionId, provider: bookmark.provider, uuid: bookmark.uuid })
    onClose()
  }, [onSelect, onClose])

  const handleRemove = useCallback((bookmark: MessageBookmark) => {
    setBookmarks((prev) => prev.filter((entry) => !(entry.uuid === bookmark.uuid && entry.sessionId === bookmark.sessionId && entry.provider === bookmark.provider)))
    void fetch(`/api/sessions/${encodeURIComponent(bookmark.sessionId)}/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: bookmark.provider, uuid: bookmark.uuid, bookmarked: false }),
    }).catch(() => load())
  }, [load])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown' || (event.key === 'j' && !event.metaKey && !event.ctrlKey)) {
        event.preventDefault()
        setCursor((value) => Math.min(value + 1, Math.max(bookmarks.length - 1, 0)))
        return
      }
      if (event.key === 'ArrowUp' || (event.key === 'k' && !event.metaKey && !event.ctrlKey)) {
        event.preventDefault()
        setCursor((value) => Math.max(value - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const target = bookmarks[cursorRef.current]
        if (target) handleSelect(target)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, bookmarks, handleSelect, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '56px 8px 8px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(760px, calc(100vw - 16px))',
          maxHeight: 'calc(100vh - 80px)',
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              display: 'grid',
              placeItems: 'center',
              background: 'color-mix(in srgb, var(--t-bookmark) 18%, var(--surface-3))',
              color: 'var(--t-bookmark)',
              border: '1px solid color-mix(in srgb, var(--t-bookmark) 34%, var(--border))',
              flexShrink: 0,
            }}
          >
            <Bookmark size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Oxanium', sans-serif", fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
              Bookmarks
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--text-3)' }}>
              {bookmarks.length} saved {bookmarks.length === 1 ? 'message' : 'messages'} across all sessions
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            title="Refresh"
            style={iconButtonStyle}
          >
            <RefreshCw size={15} className={loading ? 'av-spin' : undefined} />
          </button>
          <button type="button" onClick={onClose} title="Close" style={iconButtonStyle}>
            <X size={16} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: 8 }}>
          {error && (
            <div style={{ padding: '12px 14px', color: 'var(--red, #f87171)', fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
              {error}
            </div>
          )}
          {!error && bookmarks.length === 0 && (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
              <Bookmark size={28} style={{ opacity: 0.5, marginBottom: 10 }} />
              <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, color: 'var(--text-2)' }}>
                {loading ? 'Loading bookmarks…' : 'No bookmarks yet'}
              </div>
              {!loading && (
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, marginTop: 6 }}>
                  Hover a message and hit ☆ Bookmark to save it here.
                </div>
              )}
            </div>
          )}
          {bookmarks.map((bookmark, index) => {
            const meta = PROVIDER_META[bookmark.provider] ?? { label: bookmark.provider, color: 'var(--cyan)' }
            const active = index === cursor
            return (
              <div
                key={`${bookmark.provider}:${bookmark.sessionId}:${bookmark.uuid}`}
                onClick={() => handleSelect(bookmark)}
                onMouseEnter={() => setCursor(index)}
                className="av-bookmark-row"
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: active ? 'color-mix(in srgb, var(--cyan) 8%, transparent)' : 'transparent',
                  boxShadow: active ? 'inset 0 0 0 1px color-mix(in srgb, var(--cyan) 30%, transparent)' : 'none',
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    alignSelf: 'flex-start',
                    marginTop: 1,
                    fontSize: 10,
                    fontFamily: "'IBM Plex Mono', monospace",
                    letterSpacing: '0.04em',
                    padding: '2px 7px',
                    borderRadius: 999,
                    color: meta.color,
                    background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${meta.color} 34%, transparent)`,
                  }}
                >
                  {meta.label}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      fontSize: 13,
                      color: 'var(--text)',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {bookmark.role && (
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' }}>
                        {bookmark.role}
                      </span>
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {bookmark.sessionTitle || 'Untitled session'}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 12,
                      color: 'var(--text-2)',
                      marginTop: 3,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {bookmark.preview || '(no preview)'}
                  </div>
                </div>
                <span style={{ flexShrink: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: 'var(--text-3)', alignSelf: 'flex-start', marginTop: 2 }}>
                  {timeAgo(bookmark.createdAt)}
                </span>
                <button
                  type="button"
                  title="Remove bookmark"
                  onClick={(event) => { event.stopPropagation(); handleRemove(bookmark) }}
                  className="av-bookmark-remove"
                  style={{ ...iconButtonStyle, width: 26, height: 26, alignSelf: 'center' }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const iconButtonStyle = {
  display: 'grid',
  placeItems: 'center',
  width: 30,
  height: 30,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--surface-3)',
  color: 'var(--text-2)',
  cursor: 'pointer',
  flexShrink: 0,
} as const
