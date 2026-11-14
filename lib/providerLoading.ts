// UI-side startup tracking. Count concurrent requests so one completion cannot
// hide another session's initialization for the same provider.
import type { AgentProvider } from './types'

const counts = new Map<AgentProvider, number>()
const listeners = new Set<() => void>()
const empty: readonly AgentProvider[] = []
let snapshot: readonly AgentProvider[] = empty
export const getLoadingProviders = () => snapshot
export const getServerLoadingProviders = () => empty
export function subscribeLoadingProviders(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
function emit() {
  snapshot = [...counts.keys()]
  for (const listener of listeners) listener()
}
export function beginProviderLoading(provider: AgentProvider = 'claude'): () => void {
  counts.set(provider, (counts.get(provider) ?? 0) + 1)
  emit()
  let finished = false
  return () => {
    if (finished) return
    finished = true
    const remaining = (counts.get(provider) ?? 1) - 1
    if (remaining > 0) counts.set(provider, remaining)
    else counts.delete(provider)
    emit()
  }
}
export function providerLoadingLabel(provider: AgentProvider): string {
  const names: Partial<Record<AgentProvider, string>> = {
    claude: 'Claude', codex: 'Codex', copilot: 'Copilot', pi: 'Pi', opencode: 'OpenCode',
    'claude-acp': 'Claude ACP', 'codex-acp': 'Codex ACP', acp: 'ACP',
  }
  return `Loading ${names[provider] ?? provider}…`
}
