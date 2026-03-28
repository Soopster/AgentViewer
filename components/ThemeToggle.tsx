'use client'

import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light' | 'terminal' | 'paper'

const THEMES: Theme[] = ['dark', 'light', 'terminal', 'paper']

const THEME_META: Record<Theme, { icon: string; next: string }> = {
  dark:     { icon: '☾', next: 'light'    },
  light:    { icon: '☀', next: 'terminal' },
  terminal: { icon: '⌨', next: 'paper'    },
  paper:    { icon: '✦', next: 'dark'     },
}

const VALID: Set<string> = new Set(THEMES)

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem('theme', theme)
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  // Hydrate from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('theme')
    if (saved && VALID.has(saved)) setTheme(saved as Theme)
  }, [])

  function cycle() {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
    setTheme(next)
    applyTheme(next)
  }

  const [hovered, setHovered] = useState(false)
  const meta = THEME_META[theme]

  return (
    <button
      onClick={cycle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`Switch to ${meta.next} theme`}
      style={{
        background: hovered ? 'var(--surface-3)' : 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 5,
        color: hovered ? 'var(--text-2)' : 'var(--text-3)',
        cursor: 'pointer',
        fontSize: 13,
        lineHeight: 1,
        padding: '4px 6px',
        transition: 'background 0.14s ease, color 0.14s ease',
        flexShrink: 0,
      }}
    >
      {meta.icon}
    </button>
  )
}
