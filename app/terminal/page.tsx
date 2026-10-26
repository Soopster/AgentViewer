'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PluginSurfaceHost from '@/components/shell/PluginSurfaceHost'
import { usePluginSettingsSync } from '@/components/shell/usePluginSettingsSync'

const FONT_MONO = "'IBM Plex Mono', monospace"

const NO_SERVICES = {}

export default function TerminalPage() {
  // The Terminal plugin's view, full page; turned off, it says so.
  usePluginSettingsSync()
  const router = useRouter()
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: FONT_MONO,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Link
        href="/"
        transitionTypes={['route']}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 10,
          fontSize: 11,
          padding: '6px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: 'var(--text-2)',
          textDecoration: 'none',
          background: 'color-mix(in srgb, var(--surface) 80%, transparent)',
          backdropFilter: 'blur(4px)',
        }}
      >
        ← Back to sessions
      </Link>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', paddingTop: 44 }}>
        <PluginSurfaceHost surfaceId="terminal" placement="window" sessionKey={null} services={NO_SERVICES} onClose={() => router.push('/')} />
      </div>
    </div>
  )
}