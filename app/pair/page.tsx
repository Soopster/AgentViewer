'use client'

// Mobile pairing landing page — the target of the QR code in
// RemoteAccessPopover. Any phone's own camera app opens this as a plain
// URL (no companion app needed); it exchanges the token in the query
// string for an httpOnly session cookie via /api/remote/handshake, then
// hands off to the real app. The token never touches localStorage or any
// client-visible state beyond this one request.

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const DISPLAY = "'Oxanium', sans-serif"
const SANS = "'IBM Plex Sans', sans-serif"

type Status = 'pairing' | 'success' | 'error'

export default function PairPage() {
  return (
    <Suspense fallback={<PairShell status="pairing" message="Pairing with Agent Viewer…" />}>
      <PairContent />
    </Suspense>
  )
}

function PairContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<Status>('pairing')
  const [message, setMessage] = useState('Pairing with Agent Viewer…')

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setStatus('error')
      setMessage('Missing pairing token — rescan the QR code from the desktop app.')
      return
    }
    let cancelled = false
    fetch('/api/remote/handshake', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setStatus('error')
          setMessage('This pairing link is no longer valid — it may have been revoked or rotated. Rescan the QR code from the desktop app.')
          return
        }
        setStatus('success')
        setMessage('Paired. Opening Agent Viewer…')
        setTimeout(() => { if (!cancelled) router.replace('/') }, 700)
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
          setMessage('Could not reach Agent Viewer — check you’re on the same network as the desktop.')
        }
      })
    return () => { cancelled = true }
  }, [searchParams, router])

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
