'use client'
import { useState, useEffect } from 'react'
import type { GitSummary } from '../../lib/gitProvider'
import type { ReasoningEffortLevel, ContextUsage } from '../../lib/types'
import { SPINNER_FRAMES } from './constants'

export function detectMentionAtCursor(text: string, cursor: number): { start: number; query: string}  | null {
  if (cursor === 0) return null
  let i = cursor - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') break
    if (!ch || /\s/.test(ch)) return null
    i -= 1
  }
  if (i < 0 || text[i] !== '@') return null
  if (i > 0 && !/\s/.test(text[i - 1] ?? '')) return null
  const query = text.slice(i + 1, cursor)
  if (query.length > 60) return null
  return { start: i, query }
}
export const composerPopoverStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 6px)',
  left: 0,
  right: 60,
  maxHeight: 240,
  overflowY: 'auto',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 18px 40px rgba(0,0,0,0.34)',
  zIndex: 30,
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
}
export const composerPopoverHintStyle: React.CSSProperties = {
  padding: '4px 8px 6px',
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11,
  color: 'var(--text-3)',
  letterSpacing: '0.06em',
  borderBottom: '1px solid var(--border)',
  marginBottom: 4,
}
export const composerPopoverItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderRadius: 5,
  padding: '5px 8px',
  fontFamily: "'IBM Plex Sans', sans-serif",
  fontSize: 12,
  color: 'var(--text)',
  cursor: 'pointer',
}
export function normalizeSelectValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
export function effortLabel(level: ReasoningEffortLevel): string {
  if (level === 'xhigh') return 'Extra high'
  return level.charAt(0).toUpperCase() + level.slice(1)
}
export function gitSummariesMatch(left: GitSummary | null, right: GitSummary | null): boolean {
  return left?.branch === right?.branch
    && left?.modified === right?.modified
    && left?.untracked === right?.untracked
    && left?.stashes === right?.stashes
}
export function ComposerContextUsageRing({ usage }: { usage: ContextUsage | null} ) {
  const percentage = usage ? Math.max(0, Math.min(usage.percentage, 100)) : 0
  const ringColor = usage?.percentage && usage.percentage > 80
    ? 'var(--red, #f87171)'
    : usage?.percentage && usage.percentage > 60
      ? 'var(--yellow, #fbbf24)'
      : 'var(--violet)'
  const label = usage
    ? `Context usage: ${usage.totalTokens.toLocaleString()} of ${usage.maxTokens.toLocaleString()} tokens, ${Math.round(usage.percentage)}%`
    : 'Context usage unavailable until the provider reports it'

  return (
    <span
      className="av-web-composer-context-ring"
      role="img"
      aria-label={label}
      title={label}
      data-available={usage ? 'true' : 'false'}
      style={{
        '--av-context-progress': `${percentage * 3.6}deg`,
        '--av-context-color': ringColor,
      } as React.CSSProperties} />
  )
}
export function ComposerStatusBanner({
  tone, icon, children, action,
}: {
  tone: 'info' | 'success' | 'warning' | 'error'
  icon: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div
      className="av-web-composer-banner"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className="av-web-composer-banner-icon" aria-hidden="true">{icon}</span>
      <span className="av-web-composer-banner-message">{children}</span>
      {action ? <span className="av-web-composer-banner-action">{action}</span> : null}
    </div>
  )
}
export function LiveSpinner({ label }: { label: string} ) {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % SPINNER_FRAMES.length)
    }, 80)

    return () => window.clearInterval(timer)
  }, [])

  return (
    <span
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
        letterSpacing: '0.08em',
        color: 'var(--violet)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          color: 'var(--cyan)',
          filter: 'drop-shadow(0 0 5px var(--cyan))',
        }}
      >
        {SPINNER_FRAMES[frame]}
      </span>
      <span>{label}</span>
    </span>
  )
}
