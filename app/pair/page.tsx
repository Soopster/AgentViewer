'use client'

// Mobile pairing landing page — the target of the QR code in
// RemoteAccessPopover. Any phone's own camera app opens this as a plain
// URL (no companion app needed); it exchanges the pairing token for an
// httpOnly per-device session cookie via /api/remote/handshake, then hands
// off to the real app.
//
// The token rides in the URL *hash*, not the query string: a fragment is
// never transmitted to the server, so the secret stays out of request logs
// and any reverse-proxy access log in front of them. This page reads it
// client-side, spends it once, and strips it from the address bar so it
// doesn't linger in browser history either.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const DISPLAY = "'Oxanium', sans-serif"
const SANS = "'IBM Plex Sans', sans-serif"

type Status = 'pairing' | 'success' | 'error'

/** Accepts `#token=…` and a bare `#…`, so a hand-typed code still works. */
function readPairingToken(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const named = params.get('token')
  if (named) return named
  return raw.includes('=') ? null : decodeURIComponent(raw)
}

export default function PairPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('pairing')
  const [message, setMessage] = useState('Pairing with Agent Viewer…')

  useEffect(() => {
    const token = readPairingToken(window.location.hash)
    if (!token) {
      setStatus('error')
      setMessage('Missing pairing code — rescan the QR code from the desktop app.')
      return
    }
    // Spend-once: drop it from the address bar before the request resolves.
    window.history.replaceState(null, '', window.location.pathname)

    let cancelled = false
    let redirectTimer: number | null = null
    fetch('/api/remote/handshake', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setStatus('error')
          setMessage('This pairing code is no longer valid — it expires after a few minutes and works only once. Generate a new one from the desktop app.')
          return
        }
        const body = (await res.json().catch(() => ({}))) as { scope?: string }
        if (cancelled) return
        setStatus('success')
        setMessage(body.scope === 'read-only' ? 'Paired read-only. Opening Agent Viewer…' : 'Paired. Opening Agent Viewer…')
        redirectTimer = window.setTimeout(() => { if (!cancelled) router.replace('/') }, 700)
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
          setMessage('Could not reach Agent Viewer — check you’re on the same network as the desktop.')
        }
      })
    return () => {
      cancelled = true
      if (redirectTimer) window.clearTimeout(redirectTimer)
    }
  }, [router])

  return <PairShell status={status} message={message} />
}

function PairShell({ status, message }: { status: Status; message: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg)',
        color: 'var(--text)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            margin: '0 auto 18px',
            background: status === 'error' ? 'var(--red)' : status === 'success' ? 'var(--green)' : 'var(--cyan)',
            boxShadow: status === 'pairing' ? '0 0 0 0 rgba(56,217,245,0.5)' : 'none',
            animation: status === 'pairing' ? 'agent-viewer-pair-pulse 1.1s ease-in-out infinite' : 'none',
          }}
        />
        <div style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
          {status === 'error' ? 'Pairing failed' : 'Agent Viewer'}
        </div>
        <div style={{ fontFamily: SANS, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
          {message}
        </div>
      </div>
      <style>{`
        @keyframes agent-viewer-pair-pulse {
          0%, 100% { opacity: 0.35; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}
