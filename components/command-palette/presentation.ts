import type { PersistedSearchMatch } from '@/lib/sessionPersistence'
import type { AgentProvider } from '@/lib/types'

export function providerStyle(provider: AgentProvider): { color: string; background: string; border: string } {
  if (provider === 'codex') {
    return { color: 'var(--cyan)', background: 'rgba(56,217,245,0.10)', border: 'rgba(56,217,245,0.22)' }
  }
  if (provider === 'opencode') {
    return { color: 'var(--green)', background: 'rgba(45,212,160,0.10)', border: 'rgba(45,212,160,0.22)' }
  }
  if (provider === 'copilot') {
    return { color: 'var(--amber)', background: 'rgba(234,170,64,0.10)', border: 'rgba(234,170,64,0.22)' }
  }
  if (provider === 'pi') {
    return { color: 'var(--red)', background: 'rgba(240,80,80,0.10)', border: 'rgba(240,80,80,0.22)' }
  }
  if (provider === 'lmstudio') {
    return { color: 'var(--teal, #2dd4a7)', background: 'rgba(45,212,167,0.10)', border: 'rgba(45,212,167,0.22)' }
  }
  return { color: 'var(--violet)', background: 'rgba(139,128,240,0.10)', border: 'rgba(139,128,240,0.22)' }
}

export function providerIconLabel(provider: AgentProvider): string {
  switch (provider) {
    case 'codex':
      return 'Cx'
    case 'claude':
      return 'Cl'
    case 'opencode':
      return 'Oc'
    case 'copilot':
      return 'Cp'
    case 'pi':
      return 'Pi'
    case 'lmstudio':
      return 'Lm'
    case 'claude-acp':
      return 'Cl'
    case 'codex-acp':
      return 'Cx'
    case 'acp':
      return 'Ac'
    default:
      return 'Ai'
  }
}

export function messageTypeLabel(type: PersistedSearchMatch['type']): string {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

export function formatMessageMatchTime(timestampMs: number | null): string | null {
  if (timestampMs == null) return null
  const date = new Date(timestampMs)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
