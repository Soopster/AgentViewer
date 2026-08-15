'use client'

// Popover that makes agentViewer behave like a Claude Code IDE for a live
// `claude` CLI session — the third Claude composer flow alongside the SDK flow
// and the channel bridge. agentViewer hosts a WebSocket MCP server (the IDE
// host, channels/agentviewer-ide.ts); an external `claude` launched with the
// printed env vars connects to it. From here you push at-mentions into that
// session and watch the IDE tool calls it makes (openFile, openDiff, …),
// approving or rejecting blocking diffs inline.
//
// Connection, config, log, and the "route composer through IDE" binding are
// owned by the shared useIdeBridge hook. This component is the presentational
// surface. See channels/agentviewer-ide.ts and lib/ideBridge.ts. Mirrors
// components/ChannelBridgePanel.tsx.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Check, FileCode2, Plug, Send, Settings2, SplitSquareHorizontal, X } from 'lucide-react'
import { DEFAULT_IDE_BRIDGE_URL, type IdeBridgeStatus } from '@/lib/ideBridge'
import { ideShortPath, type IdeBridge, type IdeLogEntry } from './useIdeBridge'

const IdeDiffReviewOverlay = dynamic(() => import('./IdeDiffReviewOverlay'), { ssr: false })

export type IdeBridgeAccent = { cssVar: string; cssRgb: string; label: string }

function statusLabel(status: IdeBridgeStatus, claudeConnected: boolean): string {
  switch (status) {
    case 'connected':
      return claudeConnected ? 'host up · claude connected' : 'host up · waiting for claude'
    case 'connecting':
      return 'connecting…'
    case 'error':
      return 'host unreachable — retrying'
    default:
      return 'idle'
  }
}

function statusColor(status: IdeBridgeStatus, claudeConnected: boolean): string {
  if (status === 'error') return 'rgba(248,113,113,0.85)'
  if (status === 'connected') return claudeConnected ? 'rgba(45,212,160,0.9)' : 'rgba(234,179,8,0.9)'
  return 'var(--text-3)'
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 6px)',
  right: 0,
  width: 420,
  maxWidth: 'calc(100vw - 96px)',
  maxHeight: 520,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 18px 40px rgba(0,0,0,0.34)',
  zIndex: 40,
  overflow: 'hidden',
  fontFamily: "'IBM Plex Sans', sans-serif",
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--surface-2)',
  flexShrink: 0,
}

const iconButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  padding: 0,
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  color: 'var(--text-3)',
  cursor: 'pointer',
  flexShrink: 0,
}

const configInputStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11,
  padding: '5px 7px',
  background: 'var(--surface)',
  border: '1px solid var(--border-2)',
  borderRadius: 5,
  color: 'var(--text)',
  outline: 'none',
}

// One-line summary of an IDE tool call for the activity feed.
function toolSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'openFile':
      return ideShortPath(args.filePath)
    case 'getDiagnostics':
      return args.uri ? ideShortPath(args.uri) : 'all files'
    case 'checkDocumentDirty':
    case 'saveDocument':
      return ideShortPath(args.filePath)
    case 'close_tab':
      return typeof args.tab_name === 'string' ? args.tab_name : ''
    case 'executeCode':
      return typeof args.code === 'string' ? args.code.slice(0, 60) : ''
    default:
      return ''
  }
}

export default function IdeBridgePanel({
  accent,
  bridge,
  onClose,
  onSendComment,
}: {
  accent: IdeBridgeAccent
  bridge: IdeBridge
  onClose: () => void
  // Deliver a diff-review comment into the composer (from the review overlay).
  onSendComment?: (text: string) => void
}) {
  const {
    baseUrl,
    token,
    setBaseUrl,
    setToken,
    status,
    claudeConnected,
    entries,
    sending,
    sendError,
    setSendError,
    routeComposer,
    setRouteComposer,
    send,
    respondDiff,
  } = bridge

  const [configOpen, setConfigOpen] = useState(false)
  const [draft, setDraft] = useState('')
  // Entry id of the openDiff currently in the full-screen review overlay.
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  // Diffs we've already auto-surfaced, so resolving one doesn't immediately
  // re-pop another (and a re-render doesn't reopen a dismissed one).
  const autoOpenedRef = useRef<Set<string>>(new Set())

  const rootRef = useRef<HTMLDivElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const draftRef = useRef<HTMLTextAreaElement | null>(null)

  const accentColor = `var(${accent.cssVar})`
  const accentBg = `rgba(${accent.cssRgb},0.16)`
  const accentBorder = `rgba(${accent.cssRgb},0.4)`

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [entries])

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null
      if (rootRef.current?.contains(target)) return
      if (target?.closest('[data-ide-bridge-trigger]')) return
      onClose()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    draftRef.current?.focus()
  }, [])

  // Auto-surface the newest unresolved diff in the review overlay — openDiff is
  // a blocking, review-first interaction, so put the change front-and-centre
  // rather than leaving it as a one-line card the user might miss.
  useEffect(() => {
    if (reviewingId) return
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]
      if (entry.kind !== 'diff') continue
      if (entry.resolved || autoOpenedRef.current.has(entry.id)) break
      autoOpenedRef.current.add(entry.id)
      setReviewingId(entry.id)
      break
    }
  }, [entries, reviewingId])

  const reviewingEntry =
    reviewingId != null
      ? (entries.find((e) => e.id === reviewingId && e.kind === 'diff') as Extract<IdeLogEntry, { kind: 'diff' }> | undefined)
      : undefined

  const handleSend = useCallback(async () => {
    const text = draft.trim()
    if (!text || sending) return
    try {
      await send(text)
      setDraft('')
    } catch {
      // error surfaced via bridge.sendError
    } finally {
      draftRef.current?.focus()
    }
  }, [draft, sending, send])

  const handleVerdict = useCallback(
    (entry: Extract<IdeLogEntry, { kind: 'diff' }>, behavior: 'accept' | 'reject') => {
      void respondDiff(entry, behavior)
    },
    [respondDiff],
  )

  const onDraftKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void handleSend()
      }
    },
    [handleSend],
  )

  return (
    <div ref={rootRef} style={panelStyle} role="dialog" aria-label="IDE bridge">
      <div style={headerStyle}>
        <Plug size={14} color={accentColor} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
            IDE bridge
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: statusColor(status, claudeConnected) }}>
            {statusLabel(status, claudeConnected)} · {baseUrl.replace(/^https?:\/\//, '')}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setConfigOpen((o) => !o)}
          style={{ ...iconButtonStyle, color: configOpen ? accentColor : 'var(--text-3)' }}
          title="Connection settings"
          aria-label="Connection settings"
        >
          <Settings2 size={14} />
        </button>
        <button type="button" onClick={onClose} style={iconButtonStyle} title="Close (esc)" aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setRouteComposer(!routeComposer)}
        title="When on, lines typed in the main composer are pushed as at-mentions into the connected `claude` session instead of going to the active provider."
        aria-pressed={routeComposer}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '7px 10px',
          borderBottom: '1px solid var(--border)',
          background: routeComposer ? accentBg : 'var(--surface)',
          border: 'none',
          borderTop: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'relative',
            flexShrink: 0,
            width: 30,
            height: 17,
            borderRadius: 999,
            background: routeComposer ? accentColor : 'var(--surface-3, var(--border-2))',
            border: `1px solid ${routeComposer ? accentBorder : 'var(--border-2)'}`,
            transition: 'background 0.15s',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 1,
              left: routeComposer ? 14 : 1,
              width: 13,
              height: 13,
              borderRadius: '50%',
              background: 'var(--surface)',
              transition: 'left 0.15s',
            }}
          />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: routeComposer ? accentColor : 'var(--text)' }}>
            Route composer through IDE
          </span>
          <span style={{ fontSize: 9.5, color: 'var(--text-3)', lineHeight: 1.4 }}>
            {routeComposer
              ? 'Composer lines push as @file mentions into the live session'
              : 'Main composer sends go to the active provider'}
          </span>
        </span>
      </button>

      {configOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.04em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
              IDE host control URL
            </span>
            <input
              type="text"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={DEFAULT_IDE_BRIDGE_URL}
              style={configInputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.04em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
              Token (optional — AGENTVIEWER_IDE_CONTROL_TOKEN)
            </span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="leave blank if unset"
              style={configInputStyle}
            />
          </label>
          <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.5 }}>
            Run <code>bun run channels/agentviewer-ide.ts</code> in a terminal, then launch{' '}
            <code>claude</code> in the same shell using the printed{' '}
            <code>CLAUDE_CODE_SSE_PORT</code> / <code>ENABLE_IDE_INTEGRATION</code> exports. It connects automatically.
          </span>
        </div>
      )}

      <div ref={logRef} style={{ flex: 1, minHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px' }}>
        {entries.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 300, color: 'var(--text-3)', fontSize: 11, lineHeight: 1.6 }}>
            agentViewer is hosting a Claude Code IDE endpoint. Connect a <code>claude</code> session and its IDE tool
            calls (file opens, diffs, diagnostics) appear here. Type <code>path/to/file.ts:10-20</code> below to push an
            @mention into the session.
          </div>
        ) : (
          entries.map((entry) => {
            if (entry.kind === 'lifecycle') {
              const label =
                entry.event === 'disconnected'
                  ? 'claude disconnected'
                  : entry.event === 'connected'
                  ? 'claude connected'
                  : 'session initialized'
              return (
                <div key={entry.id} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  — {label} —
                </div>
              )
            }

            if (entry.kind === 'mention') {
              const range =
                entry.lineStart != null
                  ? `:${entry.lineStart}${entry.lineEnd && entry.lineEnd !== entry.lineStart ? `-${entry.lineEnd}` : ''}`
                  : ''
              return (
                <div key={entry.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <div
                    style={{
                      maxWidth: '88%',
                      padding: '6px 9px',
                      borderRadius: 8,
                      fontSize: 12,
                      lineHeight: 1.45,
                      background: accentBg,
                      border: `1px solid ${accentBorder}`,
                      color: 'var(--text)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      wordBreak: 'break-all',
                    }}
                  >
                    @{ideShortPath(entry.filePath)}{range}
                  </div>
                </div>
              )
            }

            if (entry.kind === 'tool') {
              const summary = toolSummary(entry.name, entry.arguments)
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 11 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, color: accentColor, flexShrink: 0 }}>
                    {entry.name}
                  </span>
                  {summary && (
                    <span style={{ color: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", wordBreak: 'break-all' }}>
                      {summary}
                    </span>
                  )}
                </div>
              )
            }

            // Blocking openDiff — accept (FILE_SAVED) or reject (DIFF_REJECTED).
            const resolved = entry.resolved
            const lineCount = entry.request.new_file_contents.split('\n').length
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'var(--surface-2)',
                  border: `1px solid ${resolved ? accentBorder : 'var(--border-2)'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <FileCode2 size={12} color={accentColor} />
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: accentColor }}>
                    {entry.request.tab_name}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>proposes a change</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', fontFamily: "'IBM Plex Mono', monospace", wordBreak: 'break-all' }}>
                  {ideShortPath(entry.request.new_file_path)} · {lineCount} line{lineCount === 1 ? '' : 's'}
                </div>
                {resolved ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: resolved === 'accept' ? 'rgba(45,212,160,0.9)' : 'rgba(248,113,113,0.85)' }}>
                    <Check size={12} />
                    {resolved === 'accept' ? 'Accepted — FILE_SAVED' : 'Rejected — DIFF_REJECTED'}
                  </div>
                ) : (
                  <>
                  <button
                    type="button"
                    onClick={() => setReviewingId(entry.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '6px 0',
                      borderRadius: 6,
                      border: `1px solid ${accentBorder}`,
                      background: accentBg,
                      color: accentColor,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <SplitSquareHorizontal size={13} /> Review changes
                  </button>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => handleVerdict(entry, 'accept')}
                      style={{
                        flex: 1,
                        padding: '6px 0',
                        borderRadius: 6,
                        border: `1px solid ${accentBorder}`,
                        background: accentBg,
                        color: accentColor,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleVerdict(entry, 'reject')}
                      style={{
                        flex: 1,
                        padding: '6px 0',
                        borderRadius: 6,
                        border: '1px solid var(--border-2)',
                        background: 'var(--surface)',
                        color: 'var(--text-2)',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Reject
                    </button>
                  </div>
                  </>
                )}
                <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  {entry.request.diff_id} · claude is blocked until you respond
                </span>
              </div>
            )
          })
        )}
      </div>

      {sendError && (
        <div style={{ padding: '6px 10px', fontSize: 11, color: 'rgba(248,113,113,0.85)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>{sendError}</span>
          <button type="button" onClick={() => setSendError(null)} style={{ ...iconButtonStyle, width: 18, height: 18 }} aria-label="Dismiss error">
            <X size={12} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <label htmlFor="ide-bridge-message" style={{ alignSelf: 'center', fontSize: 10, color: 'var(--text-3)' }}>Mention</label>
        <textarea
          id="ide-bridge-message"
          ref={draftRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onDraftKeyDown}
          placeholder="@mention a file — path/to/file.ts:10-20"
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12,
            lineHeight: 1.4,
            padding: '7px 9px',
            background: 'var(--surface)',
            border: '1px solid var(--border-2)',
            borderRadius: 6,
            color: 'var(--text)',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => {
            void handleSend()
          }}
          disabled={sending || !draft.trim()}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            flexShrink: 0,
            borderRadius: 6,
            border: `1px solid ${draft.trim() ? accentBorder : 'var(--border-2)'}`,
            background: draft.trim() ? accentBg : 'var(--surface)',
            color: draft.trim() ? accentColor : 'var(--text-3)',
            cursor: sending || !draft.trim() ? 'default' : 'pointer',
            opacity: sending ? 0.6 : 1,
          }}
          aria-label="Push at-mention into the live session"
          title="Push @mention (Enter)"
        >
          <Send size={14} />
        </button>
      </div>

      {reviewingEntry ? (
        <IdeDiffReviewOverlay
          request={reviewingEntry.request}
          accent={{ cssVar: accent.cssVar, cssRgb: accent.cssRgb }}
          onResolve={(behavior) => {
            handleVerdict(reviewingEntry, behavior)
            setReviewingId(null)
          }}
          onClose={() => setReviewingId(null)}
          onSendComment={onSendComment}
        />
      ) : null}
    </div>
  )
}
