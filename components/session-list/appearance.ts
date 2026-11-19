import { nativeSelectBaseClassName } from '@/components/ui/native-select'

import { cn } from '@/lib/utils'

export const providerNativeSelectClassName = cn(
  nativeSelectBaseClassName,
  'av-hover-control h-8 rounded-md border-transparent bg-[var(--surface-2)] bg-none px-3 text-[12px] font-medium shadow-none'
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
  border: '1px solid transparent',
  background: 'var(--surface-3)',
  color: 'var(--text)',
  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
  fontSize: 12,
  fontWeight: 500,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
}

const sidebarHeaderIconActionBaseStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  padding: 0,
  borderRadius: 6,
  border: '1px solid transparent',
  background: 'transparent',
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
      ? '1px solid transparent'
      : sidebarHeaderIconActionBaseStyle.border,
    background: options.active
      ? 'var(--surface-3)'
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
    borderRadius: 6,
    border: '1px solid transparent',
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
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    fontSize: 12,
    lineHeight: 1,
    padding: '2px 4px',
  }
}
