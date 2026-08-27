// Provider → adapter lookup, plus the assertion that keeps lib/provider.ts's
// declared SessionCapabilities honest against what the adapters actually
// implement.
//
// The failure this guards against is subtle: a capability flag says the UI may
// offer "Delete session", the adapter has no deleteSession method, and the
// button raises when a user clicks it. Checking the pair once at module load
// turns that into a startup error in development instead of a report from a
// user. Only capability flags with a read-path counterpart are checked here;
// the send/turn capabilities (fork, rewind, rollback, share, summarize,
// permission) join this table when those ops move behind the interface.

import type { AgentProvider, SessionCapabilities } from '../types'
import { getProviderCapabilities } from '../provider'
import type { SessionAdapter } from './types'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { opencodeAdapter } from './opencode'
import { copilotAdapter } from './copilot'
import { piAdapter } from './pi'
import { lmstudioAdapter } from './lmstudio'
import { claudeAcpAdapter, codexAcpAdapter } from './acp'

const ADAPTERS: Record<AgentProvider, SessionAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  copilot: copilotAdapter,
  pi: piAdapter,
  lmstudio: lmstudioAdapter,
  'claude-acp': claudeAcpAdapter,
  'codex-acp': codexAcpAdapter,
}

/** Capability flag → the adapter method that has to back it. */
const CAPABILITY_METHODS: Partial<Record<keyof SessionCapabilities, keyof SessionAdapter>> = {
  deleteSession: 'deleteSession',
}

function assertCapabilitiesMatchAdapters(): void {
  const mismatches: string[] = []
  for (const [provider, adapter] of Object.entries(ADAPTERS) as Array<[AgentProvider, SessionAdapter]>) {
    const capabilities = getProviderCapabilities(provider)
    for (const [flag, method] of Object.entries(CAPABILITY_METHODS) as Array<[keyof SessionCapabilities, keyof SessionAdapter]>) {
      const declared = capabilities[flag]
      const implemented = typeof adapter[method] === 'function'
      if (declared === implemented) continue
      mismatches.push(
        declared
          ? `${provider}: capability "${flag}" is true but the adapter has no ${method}()`
          : `${provider}: adapter implements ${method}() but capability "${flag}" is false`,
      )
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`Provider capability/adapter mismatch:\n  ${mismatches.join('\n  ')}`)
  }
}

assertCapabilitiesMatchAdapters()

export function getSessionAdapter(provider: AgentProvider): SessionAdapter {
  const adapter = ADAPTERS[provider]
  if (!adapter) throw new Error(`No session adapter registered for provider "${provider}"`)
  return adapter
}

/** Raises the way the pre-adapter branch did: naming the provider and the op,
 *  so a missing method reads as "this provider can't do that" rather than as a
 *  generic undefined-is-not-a-function further up the stack. */
export function unsupported(provider: AgentProvider, op: keyof SessionAdapter): never {
  throw new Error(`${String(op)} is not supported for ${provider} sessions`)
}
