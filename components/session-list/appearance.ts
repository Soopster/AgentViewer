import { nativeSelectBaseClassName } from '@/components/ui/native-select'

import { cn } from '@/lib/utils'

export const providerNativeSelectClassName = cn(
  nativeSelectBaseClassName,
  'av-hover-control h-9 rounded-[9px] border-[var(--border)] bg-gradient-to-b from-[var(--surface)] to-[var(--surface-2)] px-3 text-[11px] font-medium tracking-[0.04em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
)

const collapsedIconButtonBaseStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 11,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-2)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
}

export const collapsedPrimaryButtonStyle: React.CSSProperties = {
  ...collapsedIconButtonBaseStyle,
  width: 46,
  height: 46,
  borderRadius: 15,
  border: '1px solid color-mix(in srgb, var(--violet) 28%, var(--border))',
  background: 'var(--violet)',
  color: 'var(--bg)',
  boxShadow: '0 8px 24px var(--violet-glow)',
}

export const sidebarHeaderPrimaryActionStyle: React.CSSProperties = {
  height: 30,
  padding: '0 11px',
  borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--green) 40%, var(--border))',
  background: 'color-mix(in srgb, var(--green) 11%, var(--surface-2))',
  color: 'var(--green)',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.05em',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
}

const sidebarHeaderIconActionBaseStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  padding: 0,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'color-mix(in srgb, var(--surface-2) 82%, transparent)',
  color: 'var(--text-3)',
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer',
}

export function collapsedIconButtonStyle(active = false): React.CSSProperties {
  return {
    ...collapsedIconButtonBaseStyle,
    border: active ? '1px solid color-mix(in srgb, var(--violet) 46%, var(--border))' : collapsedIconButtonBaseStyle.border,
    background: active ? 'color-mix(in srgb, var(--violet) 16%, var(--surface-2))' : 'var(--surface-2)',
    color: active ? 'var(--violet)' : 'var(--text-2)',
    boxShadow: active ? '0 10px 18px var(--violet-glow)' : 'none',
  }
}

export function sidebarHeaderIconActionStyle(options: { active?: boolean; accent?: 'cyan' | 'violet'; disabled?: boolean } = {}): React.CSSProperties {
  const accent = options.accent === 'cyan' ? 'var(--cyan)' : 'var(--violet)'
  return {
    ...sidebarHeaderIconActionBaseStyle,
    border: options.active
      ? `1px solid color-mix(in srgb, ${accent} 42%, var(--border))`
      : sidebarHeaderIconActionBaseStyle.border,
    background: options.active
      ? `color-mix(in srgb, ${accent} 13%, var(--surface-2))`
      : sidebarHeaderIconActionBaseStyle.background,
    color: options.disabled ? 'var(--text-4, var(--text-3))' : options.active ? accent : sidebarHeaderIconActionBaseStyle.color,
    cursor: options.disabled ? 'not-allowed' : 'pointer',
    opacity: options.disabled ? 0.45 : 1,
  }
}

export function segmentStyle(active: boolean, position: 'first' | 'last', enabled = true): React.CSSProperties {
  return {
    flex: 1,
    height: 28,
    borderRadius: position === 'first' ? '6px 0 0 6px' : '0 6px 6px 0',
    border: '1px solid var(--border)',
    borderLeftWidth: position === 'last' ? 0 : 1,
    background: active ? 'var(--surface-3)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-3)',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.45,
  }
}

export function inboxButtonStyle(active: boolean): React.CSSProperties {
  return {
    border: '1px solid transparent',
    borderRadius: 4,
    background: active ? 'var(--surface-3)' : 'transparent',
    color: active ? 'var(--violet)' : 'var(--text-3)',
    cursor: 'pointer',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    lineHeight: 1,
    padding: '2px 4px',
  }
}
