'use client'

// Popover that bridges the composer to a live `claude` CLI session running
// alongside agentViewer, via the local channel server in channels/. Messages
// sent here land in that terminal session as <channel source="agentviewer">
// events; replies and permission prompts stream back over SSE.
//
// Connection, config, log, and the "route composer through bridge" binding are
// owned by the shared useChannelBridge hook (components/useChannelBridge.ts) so
// the main composer can send through the same connection. This component is the
// presentational surface over that controller.
//
// See channels/agentviewer-channel.ts and lib/channelBridge.ts.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Radio, Send, Settings2, X } from 'lucide-react'
import {
  channelPermissionToPending,
  DEFAULT_CHANNEL_BRIDGE_URL,
  type ChannelBridgeStatus,
} from '@/lib/channelBridge'
import type { ChannelBridge, ChannelLogEntry } from './useChannelBridge'

export type ChannelBridgeAccent = { cssVar: string; cssRgb: string; label: string }

function statusLabel(status: ChannelBridgeStatus): string {
  switch (status) {
    case 'connected': return 'connected'
    case 'connecting': return 'connecting…'
    case 'error': return 'disconnected — retrying'
    default: return 'idle'
  }
}

function statusColor(status: ChannelBridgeStatus): string {
  switch (status) {
    case 'connected': return 'rgba(45,212,160,0.9)'
    case 'error': return 'rgba(248,113,113,0.85)'
    default: return 'var(--text-3)'
  }
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

const bubbleBaseStyle: React.CSSProperties = {
  maxWidth: '88%',
  padding: '6px 9px',
  borderRadius: 8,
  fontSize: 12,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

export default function ChannelBridgePanel({
  accent,
  bridge,
  onClose,
}: {
  accent: ChannelBridgeAccent
  bridge: ChannelBridge
  onClose: () => void
}) {
  const {
    baseUrl,
    token,
    setBaseUrl,
    setToken,
    status,
    entries,
    sending,
    sendError,
    setSendError,
    routeComposer,
    setRouteComposer,
    send,
    respond,
  } = bridge

  const [configOpen, setConfigOpen] = useState(false)
  const [draft, setDraft] = useState('')

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
      if (target?.closest('[data-channel-bridge-trigger]')) return
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

  useEffect(() => { draftRef.current?.focus() }, [])

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
    (entry: Extract<ChannelLogEntry, { kind: 'permission' }>, behavior: 'allow' | 'deny') => {
      void respond(entry, behavior)
    },
    [respond],
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
    <div ref={rootRef} style={panelStyle} role="dialog" aria-label="Live CLI bridge">
      <div style={headerStyle}>
        <Radio size={14} color={accentColor} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
            Live CLI bridge
          </span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: statusColor(status) }}>
            {statusLabel(status)} · {baseUrl.replace(/^https?:\/\//, '')}
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
        title="When on, messages typed in the main composer send to this live CLI session instead of the active provider."
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
            Route composer through bridge
          </span>
          <span style={{ fontSize: 9.5, color: 'var(--text-3)', lineHeight: 1.4 }}>
            {routeComposer
              ? 'Main composer sends land in the live CLI session'
              : 'Main composer sends go to the active provider'}
          </span>
        </span>
      </button>

      {configOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.04em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
              Channel server URL
            </span>
            <input
              type="text"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={DEFAULT_CHANNEL_BRIDGE_URL}
              style={configInputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, letterSpacing: '0.04em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
              Token (optional — AGENTVIEWER_CHANNEL_TOKEN)
            </span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="leave blank if unset"
              style={configInputStyle}
            />
          </label>
          <span style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.4 }}>
            Run <code>claude --dangerously-load-development-channels server:agentviewer</code> from{' '}
            <code>channels/</code> in another terminal first.
          </span>
        </div>
      )}

      <div ref={logRef} style={{ flex: 1, minHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px' }}>
        {entries.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 280, color: 'var(--text-3)', fontSize: 11, lineHeight: 1.6 }}>
            Messages you send here land live in a <code>claude</code> CLI session running
            alongside agentViewer. Replies and permission prompts from that session stream back here.
          </div>
        ) : (
          entries.map((entry) => {
            if (entry.kind === 'sent' || entry.kind === 'reply') {
              const isSent = entry.kind === 'sent'
              return (
                <div key={entry.id} style={{ display: 'flex', justifyContent: isSent ? 'flex-end' : 'flex-start' }}>
                  <div
                    style={{
                      ...bubbleBaseStyle,
                      background: isSent ? accentBg : 'var(--surface-2)',
                      border: `1px solid ${isSent ? accentBorder : 'var(--border-2)'}`,
                      color: 'var(--text)',
                    }}
                  >
                    {entry.text}
                  </div>
                </div>
              )
            }

            const pending = channelPermissionToPending(entry.request)
            const resolved = entry.resolved
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
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: accentColor }}>
                    {pending.title}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-3)' }}>wants approval</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.45 }}>{pending.detail}</div>
                {(pending.command ?? pending.reason) && (
                  <code
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 10.5,
                      padding: '5px 7px',
                      borderRadius: 5,
                      background: 'var(--surface)',
                      border: '1px solid var(--border-2)',
                      color: 'var(--text-2)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {pending.command ?? pending.reason}
                  </code>
                )}
                {resolved ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: resolved === 'allow' ? 'rgba(45,212,160,0.9)' : 'rgba(248,113,113,0.85)' }}>
                    <Check size={12} />
                    {resolved === 'allow' ? 'Allowed' : 'Denied'} — answered from agentViewer
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => handleVerdict(entry, 'allow')}
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
                      Allow
                    </button>
                    <button
                      type="button"
                      onClick={() => handleVerdict(entry, 'deny')}
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
                      Deny
                    </button>
                  </div>
                )}
                <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  request {entry.request.request_id} · also answerable from the CLI terminal — first wins
                </span>
              </div>
            )
          })
        )}
      </div>

      {sendError && (
        <div style={{ padding: '6px 10px', fontSize: 11, color: 'rgba(248,113,113,0.85)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>{sendError}</span>
          <button
            type="button"
            onClick={() => setSendError(null)}
            style={{ ...iconButtonStyle, width: 18, height: 18 }}
            aria-label="Dismiss error"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <textarea
          ref={draftRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onDraftKeyDown}
          placeholder="Message the live CLI session…"
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            fontFamily: "'IBM Plex Sans', sans-serif",
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
          onClick={() => { void handleSend() }}
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
          aria-label="Send to live CLI session"
          title="Send (Enter)"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  )
}
