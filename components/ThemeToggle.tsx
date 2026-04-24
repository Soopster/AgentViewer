'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { applyTheme, THEME_GROUPS, THEME_META, THEMES, VALID_THEMES, type Theme } from '@/lib/themes'

export default function ThemeToggle() {
  const [theme, setTheme]   = useState<Theme>('dark')
  const [open, setOpen]     = useState(false)
  const [hovered, setHovered] = useState<Theme | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('theme')
    if (saved && VALID_THEMES.has(saved)) setTheme(saved as Theme)
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
    <div ref={ref} style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
      <Button
        onClick={() => setOpen(v => !v)}
        variant="outline"
        size="sm"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          width: '100%',
          height: 24,
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
          minWidth: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-3)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ fontSize: 12, lineHeight: 1, flexShrink: 0 }}>{meta.icon}</span>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.label}</span>
        <span style={{ fontSize: 9, color: 'var(--text-3)', marginLeft: 'auto', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </Button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 180,
            maxHeight: 360,
            overflowY: 'auto',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-2)',
            borderRadius: 7,
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
            zIndex: 100,
            padding: '4px 0',
          }}
        >
          {THEME_GROUPS.map((group, groupIndex) => (
            <div key={group.category}>
              {groupIndex > 0 && (
                <div
                  style={{
                    margin: '4px 12px',
                    borderTop: '1px solid var(--border)',
                  }}
                />
              )}
              <div
                style={{
                  padding: '6px 14px 4px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--text-3)',
                }}
              >
                {group.label}
              </div>
              {group.themes.map((t) => {
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
                      padding: '6px 14px',
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
          ))}
        </div>
      )}
    </div>
  )
}
