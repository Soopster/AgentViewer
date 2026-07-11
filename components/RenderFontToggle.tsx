'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import {
  applyRenderFont,
  DEFAULT_RENDER_FONT_ID,
  getCurrentRenderFont,
  RENDER_FONTS,
  subscribeRenderFont,
  type RenderFontId,
} from '@/lib/renderFonts'

export default function RenderFontToggle() {
  const fontId = useSyncExternalStore<RenderFontId>(
    subscribeRenderFont,
    getCurrentRenderFont,
    () => DEFAULT_RENDER_FONT_ID,
  )
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState<RenderFontId | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const current = RENDER_FONTS.find((font) => font.id === fontId) ?? RENDER_FONTS[0]!

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <Button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Rendered text font"
        aria-haspopup="listbox"
        aria-expanded={open}
        variant="outline"
        size="sm"
        className="av-hover-control"
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
      >
        <span aria-hidden="true" style={{ fontFamily: current.family, fontSize: 12, lineHeight: 1 }}>Aa</span>
        <span>{current.label}</span>
        <span aria-hidden="true" style={{ fontSize: 9, color: 'var(--text-3)', marginLeft: 1 }}>{open ? '▲' : '▼'}</span>
      </Button>

      {open ? (
        <div
          role="listbox"
          aria-label="Rendered text font"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 190,
            background: 'var(--surface-2)',
            border: '1px solid var(--border-2)',
            borderRadius: 7,
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
            zIndex: 100,
            overflow: 'hidden',
            padding: '4px 0',
          }}
        >
          {RENDER_FONTS.map((font) => {
            const isActive = font.id === fontId
            const isHovered = hovered === font.id
            return (
              <button
                key={font.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  applyRenderFont(font.id)
                  setOpen(false)
                }}
                onMouseEnter={() => setHovered(font.id)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '7px 14px',
                  cursor: 'pointer',
                  background: isHovered ? 'var(--surface-3)' : 'transparent',
                  border: 0,
                  textAlign: 'left',
                }}
              >
                <span style={{ width: 30, color: 'var(--text)', fontFamily: font.family, fontSize: 14 }}>Aa</span>
                <span style={{ flex: 1, color: isActive ? 'var(--violet)' : 'var(--text-2)', fontFamily: font.family, fontSize: 12 }}>
                  {font.label}
                </span>
                {isActive ? <span style={{ color: 'var(--violet)', fontSize: 10 }}>✓</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
