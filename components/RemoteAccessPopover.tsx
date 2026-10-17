'use client'

// Remote/mobile access settings: opt-in toggle, pairing QR, and the list of
// paired devices with per-device revoke. Modeled on the other purpose-built
// popovers (ProvenancePopover, GitPopover) — this app has no general
// "Settings" surface yet, so this is its own small popover rather than a page.
//
// The QR carries a single-use, short-lived pairing code in the URL *hash*
// (see app/pair/page.tsx), which the phone exchanges for its own device
// session. One device's revoke therefore leaves the others paired.
//
// The bind address (loopback-only vs LAN-visible) is fixed for the running
// process's lifetime — see bin/agent-viewer.mjs's resolveWebHostname() and
// src-tauri/src/lib.rs's resolve_web_hostname(). Toggling here updates the
// *auth* check immediately (lib/remoteAuth.ts reads its state file fresh
// each request); the network port itself only opens/closes after a restart.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { QrCode, ShieldOff, Smartphone, Trash2, X } from 'lucide-react'
import QRCode from 'qrcode'
import { readJsonResponse } from '@/lib/httpResponse'

type Props = {
  open: boolean
  onClose: () => void
}

type RemoteScope = 'full' | 'read-only'

type PairedDevice = {
  id: string
  label: string
  scope: RemoteScope
  createdAt: string
  lastSeenAt: string | null
  userAgent: string | null
}

type EndpointKind = 'loopback' | 'lan' | 'private' | 'tunnel'

type AdvertisedEndpoint = {
  id: string
  kind: EndpointKind
  host: string
  source: string
  https: boolean
  label: string
}

type RemoteAccessState = {
  enabled: boolean
  createdAt: string | null
  pairing: { id: string; token: string; scope: RemoteScope; expiresAt: string } | null
  sessions: PairedDevice[]
  port: number
  endpoints: AdvertisedEndpoint[]
  defaultId: string | null
  preferredKind: EndpointKind | null
  tailscale: { available: boolean; running: boolean; serveEnabled: boolean; magicDnsName: string | null }
}

const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"
const DISPLAY = "'Oxanium', sans-serif"

function endpointOrigin(endpoint: AdvertisedEndpoint, port: number): string {
  const scheme = endpoint.https ? 'https' : 'http'
  // A Serve-fronted tunnel terminates TLS on 443 and needs no explicit port.
  if (endpoint.https) return `${scheme}://${endpoint.host}`
  return `${scheme}://${endpoint.host}:${port}`
}

function pairingUrl(state: RemoteAccessState, endpoint: AdvertisedEndpoint | null): string | null {
  if (!state.pairing || !endpoint) return null
  // A plain URL, not a JSON payload — any phone's own Camera/QR scanner can
  // open this directly (no companion app needed). The code sits in the hash
  // so it never reaches the server; /pair reads it client-side.
  return `${endpointOrigin(endpoint, state.port)}/pair#token=${encodeURIComponent(state.pairing.token)}`
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const delta = Date.now() - Date.parse(iso)
  if (!Number.isFinite(delta)) return 'unknown'
  if (delta < 60_000) return 'just now'
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatCountdown(expiresAt: string, now: number): string | null {
  const remaining = Date.parse(expiresAt) - now
  if (!Number.isFinite(remaining) || remaining <= 0) return null
  const seconds = Math.ceil(remaining / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export default function RemoteAccessPopover({ open, onClose }: Props) {
  const [state, setState] = useState<RemoteAccessState | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justChanged, setJustChanged] = useState(false)
  const [scope, setScope] = useState<RemoteScope>('full')
  const [now, setNow] = useState(() => Date.now())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAllEndpoints, setShowAllEndpoints] = useState(false)

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

  // One shared ticker drives both the countdown and the "expired" transition,
  // so a stale QR visibly stops being offered instead of silently failing.
  useEffect(() => {
    if (!open || !state?.pairing) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open, state?.pairing])

  const countdown = state?.pairing ? formatCountdown(state.pairing.expiresAt, now) : null
  const pairingLive = countdown !== null

  const endpoints = useMemo(() => state?.endpoints ?? [], [state])
  // The selection is by id, but it falls back through the server's default so
  // an interface disappearing (unplugged cable, VPN down) can't strand the QR.
  const selectedEndpoint = useMemo(
    () =>
      endpoints.find((entry) => entry.id === selectedId)
      ?? endpoints.find((entry) => entry.id === state?.defaultId)
      ?? endpoints[0]
      ?? null,
    [endpoints, selectedId, state?.defaultId],
  )

  useEffect(() => {
    const payload = state && pairingLive ? pairingUrl(state, selectedEndpoint) : null
    if (!state?.enabled || !payload) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    QRCode.toDataURL(payload, { margin: 1, width: 220, color: { dark: '#dde3f5', light: '#00000000' } })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => { if (!cancelled) setQrDataUrl(null) })
    return () => { cancelled = true }
  }, [state, pairingLive, selectedEndpoint])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const runAction = useCallback((body: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    fetch('/api/remote-access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(readJsonResponse)
      .then((data) => { setState(data as RemoteAccessState); setJustChanged(true); setNow(Date.now()) })
      .catch((err) => setError(err instanceof Error ? err.message : `Failed to ${body.action}`))
      .finally(() => setBusy(false))
  }, [])

  const devices = useMemo(() => state?.sessions ?? [], [state])

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
                    Lets a paired device on the same network view and drive sessions. Never enable this over an untrusted network.
                  </div>
                </div>
                <button
                  type="button"
                  className="av-hover-control"
                  role="switch"
                  aria-checked={state.enabled}
                  disabled={busy}
                  onClick={() => runAction({ action: state.enabled ? 'disable' : 'enable', scope })}
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
                <>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['full', 'read-only'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="av-hover-control"
                        onClick={() => setScope(option)}
                        style={{
                          ...scopeChipStyle,
                          color: scope === option ? 'var(--violet)' : 'var(--text-2)',
                          borderColor: scope === option ? 'color-mix(in srgb, var(--violet) 45%, var(--border))' : 'var(--border)',
                          background: scope === option ? 'color-mix(in srgb, var(--violet) 14%, var(--surface-2))' : 'var(--surface-2)',
                        }}
                      >
                        {option === 'full' ? 'Full control' : 'Read-only'}
                      </button>
                    ))}
                    <div style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="av-hover-control"
                      disabled={busy}
                      onClick={() => runAction({ action: 'pair', scope })}
                      style={{ ...secondaryButtonStyle, opacity: busy ? 0.6 : 1 }}
                    >
                      <QrCode size={13} />
                      New code
                    </button>
                  </div>

                  {endpoints.length === 0 ? (
                    <div style={{ fontFamily: SANS, fontSize: 12, color: 'var(--text-2)' }}>
                      No reachable address detected — connect this machine to Wi-Fi/Ethernet to pair a device.
                    </div>
                  ) : pairingLive && qrDataUrl ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={qrDataUrl}
                        alt="Scan with your phone's camera to pair"
                        style={{ width: 180, height: 180, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: 8 }}
                      />
                      <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-2)', textAlign: 'center' }}>
                        Scan with your phone's camera — one device, expires in {countdown}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-3)', textAlign: 'center' }}>
                        {selectedEndpoint ? endpointOrigin(selectedEndpoint, state.port) : '—'}
                        {' · '}
                        {state.pairing?.scope === 'read-only' ? 'read-only' : 'full control'}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '10px 0' }}>
                      <div style={{ width: 180, height: 180, borderRadius: 10, background: 'var(--surface-2)', border: '1px dashed var(--border-2)', display: 'grid', placeItems: 'center', padding: 16 }}>
                        <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.5 }}>
                          {state.pairing ? 'Pairing code expired' : 'No pairing code'}
                          <br />
                          Generate one to add a device.
                        </div>
                      </div>
                    </div>
                  )}

                  {endpoints.length > 0 ? (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                        <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                          Address
                        </div>
                        {endpoints.length > 1 ? (
                          <button
                            type="button"
                            className="av-hover-control"
                            onClick={() => setShowAllEndpoints((value) => !value)}
                            style={linkButtonStyle}
                          >
                            {showAllEndpoints ? 'show fewer' : `+${endpoints.length - 1} other${endpoints.length > 2 ? 's' : ''}`}
                          </button>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(showAllEndpoints ? endpoints : endpoints.filter((entry) => entry.id === selectedEndpoint?.id)).map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className="av-hover-control"
                            disabled={busy}
                            onClick={() => {
                              setSelectedId(entry.id)
                              setShowAllEndpoints(false)
                              // Persist the *kind*, not the address — a DHCP
                              // lease change must not lose the preference.
                              if (entry.kind !== state.preferredKind) runAction({ action: 'prefer-endpoint', kind: entry.kind })
                            }}
                            style={{
                              ...endpointRowStyle,
                              borderColor: entry.id === selectedEndpoint?.id
                                ? 'color-mix(in srgb, var(--violet) 45%, var(--border))'
                                : 'var(--border)',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                              <div style={{ fontFamily: MONO, fontSize: 11.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {endpointOrigin(entry, state.port)}
                              </div>
                              <div style={{ fontFamily: SANS, fontSize: 10.5, color: 'var(--text-3)' }}>
                                {entry.label}
                              </div>
                            </div>
                            {entry.https ? (
                              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--green)' }}>HTTPS</span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {state.tailscale.available ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
                          Tailscale Serve
                        </div>
                        <div style={{ fontFamily: SANS, fontSize: 11, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.4 }}>
                          {state.tailscale.running
                            ? 'Adds an HTTPS address your phone can reach off Wi-Fi. Pairing works the same way.'
                            : 'Tailscale is installed but not running — start it to use this.'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="av-hover-control"
                        role="switch"
                        aria-checked={state.tailscale.serveEnabled}
                        disabled={busy || !state.tailscale.running}
                        onClick={() => runAction({ action: 'tailscale-serve', enabled: !state.tailscale.serveEnabled })}
                        style={{
                          flexShrink: 0,
                          width: 40,
                          height: 22,
                          borderRadius: 999,
                          border: '1px solid var(--border-2)',
                          background: state.tailscale.serveEnabled ? 'var(--violet)' : 'var(--surface-3)',
                          position: 'relative',
                          cursor: busy || !state.tailscale.running ? 'default' : 'pointer',
                          opacity: busy || !state.tailscale.running ? 0.5 : 1,
                          transition: 'background 120ms ease',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            top: 2,
                            left: state.tailscale.serveEnabled ? 20 : 2,
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            background: 'var(--text)',
                            transition: 'left 120ms ease',
                          }}
                        />
                      </button>
                    </div>
                  ) : null}

                  <div>
                    <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                      Paired devices{devices.length ? ` (${devices.length})` : ''}
                    </div>
                    {devices.length === 0 ? (
                      <div style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--text-3)' }}>
                        None yet — scan the code above from a phone.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {devices.map((device) => (
                          <div
                            key={device.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '8px 10px',
                              background: 'var(--surface-2)',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {device.label}
                                {device.scope === 'read-only' ? (
                                  <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--text-3)', marginLeft: 6 }}>read-only</span>
                                ) : null}
                              </div>
                              <div style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-3)' }}>
                                last seen {formatRelative(device.lastSeenAt)}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="av-hover-control"
                              disabled={busy}
                              title="Revoke this device"
                              onClick={() => runAction({ action: 'revoke', sessionId: device.id })}
                              style={{ ...iconButtonStyle, width: 28, height: 28, color: 'var(--red)', opacity: busy ? 0.6 : 1 }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="av-hover-control"
                      disabled={busy || devices.length === 0}
                      onClick={() => runAction({ action: 'revoke-all' })}
                      style={{ ...secondaryButtonStyle, opacity: busy || devices.length === 0 ? 0.5 : 1, color: 'var(--red)' }}
                    >
                      <ShieldOff size={13} />
                      Revoke all devices
                    </button>
                  </div>
                </>
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

const endpointRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 10px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  cursor: 'pointer',
} as const

const linkButtonStyle = {
  fontFamily: SANS,
  fontSize: 11,
  color: 'var(--text-3)',
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
} as const

const scopeChipStyle = {
  fontFamily: SANS,
  fontSize: 11.5,
  fontWeight: 500,
  borderRadius: 8,
  border: '1px solid var(--border)',
  padding: '6px 10px',
  cursor: 'pointer',
} as const
