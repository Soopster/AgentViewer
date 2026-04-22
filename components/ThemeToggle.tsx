'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type Theme =
  | 'light'
  | 'paper'
  | 'solarized-light'
  | 'github-light'
  | 'gruvbox-light'
  | 'catppuccin-latte'
  | 'rose-pine-dawn'
  | 'ayu-light'
  | 'one-light'
  | 'everforest-light'
  | 'tokyo-night-day'
  | 'quiet-light'
  | 'horizon-light'
  | 'imessage'
  | 'dark'
  | 'terminal'
  | 'solarized-dark'
  | 'nord'
  | 'gruvbox-dark'
  | 'dracula'
  | 'tokyo-night'
  | 'catppuccin-mocha'
  | 'one-dark'
  | 'monokai'
  | 'kanagawa'
  | 'everforest-dark'
  | 'obsidian'
  | 'github-dark'
  | 'ayu-dark'
  | 'rose-pine'
  | 'synthwave'
  | 'palenight'
  | 'night-owl'
  | 'cyber'

type ThemeCategory = 'dark' | 'light'

const THEME_META: Record<Theme, { category: ThemeCategory; icon: string; label: string }> = {
  light:              { category: 'light', icon: '☀', label: 'Light' },
  paper:              { category: 'light', icon: '✦', label: 'Paper' },
  'solarized-light':  { category: 'light', icon: '☀', label: 'Solarized Light' },
  'github-light':     { category: 'light', icon: '☀', label: 'GitHub Light' },
  'gruvbox-light':    { category: 'light', icon: '☀', label: 'Gruvbox Light' },
  'catppuccin-latte': { category: 'light', icon: '☀', label: 'Catppuccin Latte' },
  'rose-pine-dawn':   { category: 'light', icon: '☀', label: 'Rosé Pine Dawn' },
  'ayu-light':        { category: 'light', icon: '☀', label: 'Ayu Light' },
  'one-light':        { category: 'light', icon: '☀', label: 'One Light' },
  'everforest-light': { category: 'light', icon: '☀', label: 'Everforest Light' },
  'tokyo-night-day':  { category: 'light', icon: '☀', label: 'Tokyo Night Day' },
  'quiet-light':      { category: 'light', icon: '☀', label: 'Quiet Light' },
  'horizon-light':    { category: 'light', icon: '☀', label: 'Horizon Light' },
  imessage:           { category: 'light', icon: '💬', label: 'iMessage' },
  dark:               { category: 'dark',  icon: '☾', label: 'Dark' },
  terminal:           { category: 'dark',  icon: '⌨', label: 'Terminal' },
  'solarized-dark':   { category: 'dark',  icon: '☾', label: 'Solarized Dark' },
  nord:               { category: 'dark',  icon: '☾', label: 'Nord' },
  'gruvbox-dark':     { category: 'dark',  icon: '☾', label: 'Gruvbox Dark' },
  dracula:            { category: 'dark',  icon: '☾', label: 'Dracula' },
  'tokyo-night':      { category: 'dark',  icon: '☾', label: 'Tokyo Night' },
  'catppuccin-mocha': { category: 'dark',  icon: '☾', label: 'Catppuccin Mocha' },
  'one-dark':         { category: 'dark',  icon: '☾', label: 'One Dark' },
  monokai:            { category: 'dark',  icon: '☾', label: 'Monokai' },
  kanagawa:           { category: 'dark',  icon: '☾', label: 'Kanagawa' },
  'everforest-dark':  { category: 'dark',  icon: '☾', label: 'Everforest Dark' },
  obsidian:           { category: 'dark',  icon: '☾', label: 'Obsidian' },
  'github-dark':      { category: 'dark',  icon: '☾', label: 'GitHub Dark' },
  'ayu-dark':         { category: 'dark',  icon: '☾', label: 'Ayu Dark' },
  'rose-pine':        { category: 'dark',  icon: '☾', label: 'Rosé Pine' },
  synthwave:          { category: 'dark',  icon: '✦', label: 'Synthwave' },
  palenight:          { category: 'dark',  icon: '☾', label: 'Palenight' },
  'night-owl':        { category: 'dark',  icon: '☾', label: 'Night Owl' },
  cyber:              { category: 'dark',  icon: '✦', label: 'Cyber' },
}

const THEMES: Theme[] = Object.keys(THEME_META) as Theme[]
const VALID: Set<string> = new Set(THEMES)
const THEME_GROUPS: Array<{ category: ThemeCategory; label: string; themes: Theme[] }> = [
  { category: 'light', label: 'Light', themes: THEMES.filter((t) => THEME_META[t].category === 'light') },
  { category: 'dark',  label: 'Dark',  themes: THEMES.filter((t) => THEME_META[t].category === 'dark') },
]

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
