'use client'

import Link from 'next/link'
import TerminalView from '@/components/TerminalView'

const FONT_MONO = "'IBM Plex Mono', monospace"

export default function TerminalPage() {
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
        <TerminalView />
      </div>
    </div>
  )
}