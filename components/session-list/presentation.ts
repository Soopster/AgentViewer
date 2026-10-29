import type { AgentProvider, Session } from '@/lib/types'
import type { SessionTeamAttention } from './types'

export function sessionAttentionPresentation(teammates: SessionTeamAttention | undefined) {
  if (!teammates || !(teammates.waiting > 0 || teammates.finished > 0)) return null
  const waiting = teammates.waiting > 0
  return {
    title: waiting
      ? `${teammates.waiting} teammate item${teammates.waiting === 1 ? '' : 's'} need you${teammates.finished ? `, ${teammates.finished} finished` : ''}`
      : `${teammates.finished} teammate result${teammates.finished === 1 ? '' : 's'} to review`,
    color: waiting ? 'var(--amber)' : 'var(--green)',
    label: waiting ? `! ${teammates.waiting}` : `✓ ${teammates.finished}`,
  }
}

export function timeAgo(value?: string | number): string {
  if (value == null) return ''
  const ms = Date.now() - new Date(value).getTime()
  const m  = Math.floor(ms / 60_000)
  if (m < 60)  return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export function formatTimestamp(value?: string | number): string {
  if (value == null) return ''
  return new Date(value).toLocaleString()
}

export function formatStableTimestamp(value?: string | number): string {
  if (value == null) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

export function formatStableTimeLabel(value?: string | number): string {
  if (value == null) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(11, 16) + ' UTC'
}

export function getSessionTitle(session: Session): string {
  return session.customTitle ?? session.summary ?? ''
}

export function getSessionPreview(session: Session, sessionTitle: string): string | null {
  const preview = session.firstPrompt?.trim()
  if (!preview) return null
  if (preview === sessionTitle) return null
  return preview
}

export function sessionTabKey(session: Pick<Session, 'sessionId' | 'provider' | 'providerInstanceId'>): string {
  return `${session.providerInstanceId ?? session.provider ?? 'claude'}:${session.sessionId}`
}

export function providerChipStyle(provider: AgentProvider): { color: string; background: string; border: string } {
  if (provider === 'codex') {
    return { color: 'var(--cyan)', background: 'rgba(56,217,245,0.08)', border: 'rgba(56,217,245,0.22)' }
  }
  if (provider === 'opencode') {
    return { color: 'var(--green)', background: 'rgba(45,212,160,0.08)', border: 'rgba(45,212,160,0.22)' }
  }
  if (provider === 'copilot') {
    return { color: 'var(--amber)', background: 'rgba(234,170,64,0.08)', border: 'rgba(234,170,64,0.22)' }
  }
  if (provider === 'pi') {
    return { color: 'var(--red)', background: 'rgba(240,80,80,0.08)', border: 'rgba(240,80,80,0.22)' }
  }
  return { color: 'var(--violet)', background: 'rgba(139,128,240,0.08)', border: 'rgba(139,128,240,0.22)' }
}

const PROVIDER_LABELS: Partial<Record<AgentProvider, string>> = {
  claude: 'Claude',
  'claude-acp': 'Claude (ACP)',
  codex: 'Codex',
  'codex-acp': 'Codex (ACP)',
  acp: 'ACP agent',
  opencode: 'OpenCode',
  copilot: 'Copilot',
  pi: 'Pi',
}

export function providerLabel(provider: AgentProvider): string {
  return PROVIDER_LABELS[provider] ?? provider
}

export function formatCompactTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}
