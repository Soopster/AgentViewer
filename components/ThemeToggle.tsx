'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type Theme = 'dark' | 'light' | 'terminal' | 'paper' | 'imessage'

const THEMES: Theme[] = ['dark', 'light', 'terminal', 'paper', 'imessage']

const THEME_META: Record<Theme, { icon: string; label: string }> = {
  dark:     { icon: '☾', label: 'Dark'     },
  light:    { icon: '☀', label: 'Light'    },
  terminal: { icon: '⌨', label: 'Terminal' },
  paper:    { icon: '✦', label: 'Paper'    },
  imessage: { icon: '💬', label: 'iMessage' },
}

const VALID: Set<string> = new Set(THEMES)

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('theme', theme)
}

export default function ThemeToggle() {
  const [theme, setTheme]   = useState<Theme>('dark')
  const [open, setOpen]     = useState(false)
  const [hovered, setHovered] = useState<Theme | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('theme')
    if (saved && VALID.has(saved)) setTheme(saved as Theme)
  }, [])

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  function select(t: Theme) {
    setTheme(t)
    applyTheme(t)
    setOpen(false)
  }

  const meta = THEME_META[theme]

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      {/* Trigger button */}
      <Button
        onClick={() => setOpen(v => !v)}
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
          transition: 'background 0.14s ease, border-color 0.14s ease',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ fontSize: 12, lineHeight: 1 }}>{meta.icon}</span>
        <span>{meta.label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-3)', marginLeft: 1 }}>{open ? '▲' : '▼'}</span>
      </Button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 130,
            background: 'var(--surface-2)',
            border: '1px solid var(--border-2)',
            borderRadius: 7,
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
            zIndex: 100,
            overflow: 'hidden',
            padding: '4px 0',
          }}
        >
          {THEMES.map((t) => {
            const m = THEME_META[t]
            const isActive = t === theme
            const isHov = hovered === t
            return (
              <div
                key={t}
                onClick={() => select(t)}
                onMouseEnter={() => setHovered(t)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '7px 14px',
                  cursor: 'pointer',
                  background: isHov ? 'var(--surface-3)' : 'transparent',
                  transition: 'background 0.1s ease',
                }}
              >
                <span style={{ fontSize: 13, lineHeight: 1, width: 16, textAlign: 'center' }}>{m.icon}</span>
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.05em',
                    color: isActive ? 'var(--violet)' : isHov ? 'var(--text)' : 'var(--text-2)',
                    flex: 1,
                  }}
                >
                  {m.label}
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
