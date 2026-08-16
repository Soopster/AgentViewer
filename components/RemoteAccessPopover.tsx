'use client'

// Remote/mobile access settings: opt-in toggle, pairing QR (LAN URL + bearer
// token), and rotate/revoke. Modeled on the other purpose-built popovers
// (ProvenancePopover, GitPopover) — this app has no general "Settings"
// surface yet, so this is its own small popover rather than a page.
//
// The bind address (loopback-only vs LAN-visible) is fixed for the running
// process's lifetime — see bin/agent-viewer.mjs's resolveWebHostname() and
// src-tauri/src/lib.rs's resolve_web_hostname(). Toggling here updates the
// *auth* check immediately (lib/remoteAuth.ts reads its state file fresh
// each request); the network port itself only opens/closes after a restart.

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ShieldOff, Smartphone, X } from 'lucide-react'
import QRCode from 'qrcode'
import { readJsonResponse } from '@/lib/httpResponse'

type Props = {
  open: boolean
  onClose: () => void
}

type RemoteAccessState = {
  enabled: boolean
  token: string | null
  createdAt: string | null
  lanAddress: string | null
}

const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const DISPLAY = "'Oxanium', sans-serif"

function pairingUrl(state: RemoteAccessState): string | null {
  if (!state.token || !state.lanAddress) return null
  const port = typeof window !== 'undefined' ? window.location.port || '3000' : '3000'
  // A plain URL, not a JSON payload — any phone's own Camera/QR scanner can
  // open this directly (no companion app needed). /pair reads the token and
  // completes the handshake itself; see app/pair/page.tsx.
  return `http://${state.lanAddress}:${port}/pair?token=${encodeURIComponent(state.token)}`
}

export default function RemoteAccessPopover({ open, onClose }: Props) {
  const [state, setState] = useState<RemoteAccessState | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justChanged, setJustChanged] = useState(false)

  const load = useCallback(() => {
    setError(null)
    fetch('/api/remote-access')
      .then(readJsonResponse)
      .then((data) => setState(data as RemoteAccessState))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load remote-access state'))
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  useEffect(() => {
    const payload = state ? pairingUrl(state) : null
    if (!state?.enabled || !payload) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(payload, { margin: 1, width: 220, color: { dark: '#dde3f5', light: '#00000000' } })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => { if (!cancelled) setQrDataUrl(null) })
    return () => { cancelled = true }
  }, [state])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const runAction = useCallback((action: 'enable' | 'disable' | 'rotate') => {
    setBusy(true)
    setError(null)
    fetch('/api/remote-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
      .then(readJsonResponse)
      .then((data) => { setState(data as RemoteAccessState); setJustChanged(true) })
      .catch((err) => setError(err instanceof Error ? err.message : `Failed to ${action}`))
      .finally(() => setBusy(false))
  }, [])

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
        padding: '48px 8px 8px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, calc(100vw - 16px))',
          maxHeight: 'calc(100vh - 64px)',
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
              background: 'color-mix(in srgb, var(--violet) 18%, var(--surface-3))',
              color: 'var(--violet)',
              border: '1px solid color-mix(in srgb, var(--violet) 34%, var(--border))',
              flexShrink: 0,
            }}
          >
            <Smartphone size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
              Remote access
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-3)' }}>
              Pair a phone on your LAN — off by default
            </div>
          </div>
          <button type="button" className="av-hover-control" onClick={onClose} title="Close" style={iconButtonStyle}>
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error ? (
            <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 12%, var(--surface-2))', border: '1px solid color-mix(in srgb, var(--red) 30%, var(--border))', borderRadius: 8, padding: '8px 10px' }}>
              {error}
            </div>
          ) : null}

          {!state ? (
            <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-2)' }}>Loading…</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    Allow remote access
                  </div>
                  <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.4 }}>
                    Lets a paired device on the same network view and drive sessions. Never disable this over an untrusted network.
                  </div>
                </div>
                <button
                  type="button"
                  className="av-hover-control"
                  role="switch"
                  aria-checked={state.enabled}
                  disabled={busy}
                  onClick={() => runAction(state.enabled ? 'disable' : 'enable')}
                  style={{
                    flexShrink: 0,
                    width: 40,
                    height: 22,
                    borderRadius: 999,
                    border: '1px solid var(--border-2)',
                    background: state.enabled ? 'var(--violet)' : 'var(--surface-3)',
                    position: 'relative',
                    cursor: busy ? 'default' : 'pointer',
                    opacity: busy ? 0.6 : 1,
                    transition: 'background 120ms ease',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: state.enabled ? 20 : 2,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: 'var(--text)',
                      transition: 'left 120ms ease',
                    }}
                  />
                </button>
              </div>

              {justChanged ? (
                <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 12%, var(--surface-2))', border: '1px solid color-mix(in srgb, var(--amber) 30%, var(--border))', borderRadius: 8, padding: '8px 10px', lineHeight: 1.4 }}>
                  Pairing already reflects this change. The network port itself only opens or closes after you restart Agent Viewer.
                </div>
              ) : null}

              {state.enabled ? (
                state.lanAddress ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                    {qrDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qrDataUrl}
                        alt="Scan with your phone's camera to pair"
                        style={{ width: 180, height: 180, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: 8 }}
                      />
                    ) : (
                      <div style={{ width: 180, height: 180, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center' }}>
                        <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-3)' }}>Generating…</div>
                      </div>
                    )}
                    <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-2)', textAlign: 'center' }}>
                      Scan with your phone's camera — no app needed, opens in its browser
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>
                      {state.lanAddress}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-2)' }}>
                    No LAN address detected — connect this machine to Wi-Fi/Ethernet to pair a device.
                  </div>
                )
              ) : null}

              {state.enabled ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="av-hover-control"
                    disabled={busy}
                    onClick={() => runAction('rotate')}
                    style={{ ...secondaryButtonStyle, opacity: busy ? 0.6 : 1 }}
                  >
                    <RefreshCw size={13} />
                    Rotate token
                  </button>
                  <button
                    type="button"
                    className="av-hover-control"
                    disabled={busy}
                    onClick={() => runAction('disable')}
                    style={{ ...secondaryButtonStyle, opacity: busy ? 0.6 : 1, color: 'var(--red)' }}
                  >
                    <ShieldOff size={13} />
                    Revoke access
                  </button>
                </div>
              ) : null}
            </>
          )}
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

const secondaryButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text)',
  background: 'var(--surface-3)',
  border: '1px solid var(--border-2)',
  borderRadius: 8,
  padding: '7px 12px',
  cursor: 'pointer',
} as const
