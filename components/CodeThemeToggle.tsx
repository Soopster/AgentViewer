'use client'

import { useEffect, useRef, useState } from 'react'
import { CODE_THEMES } from '@/lib/codeThemes'
import { Button } from '@/components/ui/button'
import { useCodeTheme } from './CodeThemeContext'

export default function CodeThemeToggle() {
  const { themeId, setTheme } = useCodeTheme()
  const [open, setOpen]       = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const current = CODE_THEMES.find(t => t.id === themeId)!

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <Button
        onClick={() => setOpen(v => !v)}
        title="Code syntax theme"
        variant="outline"
        size="sm"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          background: open ? 'var(--surface-3)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 5,
          color: 'var(--text-2)',
          cursor: 'pointer',
          padding: '4px 8px',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          letterSpacing: '0.05em',
          transition: 'background 0.14s ease',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ fontSize: 11, lineHeight: 1 }}>{'</>'}</span>
        <span>{current.label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-3)', marginLeft: 1 }}>{open ? '▲' : '▼'}</span>
      </Button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 160,
            background: 'var(--surface-2)',
            border: '1px solid var(--border-2)',
            borderRadius: 7,
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
            zIndex: 100,
            overflow: 'hidden',
            padding: '4px 0',
          }}
        >
          {CODE_THEMES.map((t) => {
            const isActive = t.id === themeId
            const isHov = hovered === t.id
            return (
              <div
                key={t.id}
                onClick={() => { setTheme(t.id); setOpen(false) }}
                onMouseEnter={() => setHovered(t.id)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 14px',
                  cursor: 'pointer',
                  background: isHov ? 'var(--surface-3)' : 'transparent',
                  transition: 'background 0.1s ease',
                }}
              >
                {/* Dark/light indicator dot */}
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: t.dark ? '#1e1e2e' : '#f8f8f8',
                  border: '1px solid var(--border-2)',
                  boxShadow: t.dark ? 'inset 0 0 0 1.5px rgba(255,255,255,0.08)' : 'inset 0 0 0 1.5px rgba(0,0,0,0.08)',
                }} />
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    color: isActive ? 'var(--violet)' : isHov ? 'var(--text)' : 'var(--text-2)',
                    flex: 1,
                  }}
                >
                  {t.label}
                </span>
                {isActive && (
                  <span style={{ color: 'var(--violet)', fontSize: 10 }}>✓</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
