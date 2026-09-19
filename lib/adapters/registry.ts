// Provider → adapter lookup, plus the assertion that keeps lib/provider.ts's
// declared SessionCapabilities honest against what the adapters actually
// implement.
//
// The failure this guards against is subtle: a capability flag says the UI may
// offer "Delete session", the adapter has no deleteSession method, and the
// button raises when a user clicks it. Checking the pair turns that into a
// startup error in development instead of a report from a user. Only
// capability flags with a read-path counterpart are checked here; the
// send/turn capabilities (fork, rewind, rollback, share, summarize,
// permission) join this table when those ops move behind the interface.
//
// **Adapters are loaded on demand, one provider at a time** (load-bearing).
// Each adapter drags its provider's whole SDK in with it, and those SDKs are
// the dominant term in this process's memory: importing all eight costs ~88MB
// of RSS before a single session is read. A Claude-only user was paying for
// Codex, OpenCode, Copilot, Pi, LM Studio and both ACP transports as well —
// and paying it again in every Worker that reads sessions, since a Bun Worker
// re-imports the graph into its own VM. Resolving lazily means a process only
// materializes the providers it actually talks to.
//
// The anti-drift guard survives the change by moving from "check all eight at
// module load" to "check each adapter the first time it loads", so any
// provider a process actually uses is still verified. `npm run adapters:smoke`
// calls assertAllAdapterCapabilities() to keep covering all eight at once.

import type { AgentProvider, SessionCapabilities } from '../types'
import { getProviderCapabilities } from '../provider'
import type { SessionAdapter } from './types'

/** One dynamic import per provider. Static analysis still sees every specifier,
 *  so bundlers keep resolving them; only evaluation is deferred. */
const ADAPTER_LOADERS: Record<AgentProvider, () => Promise<SessionAdapter>> = {
  claude: async () => (await import('./claude')).claudeAdapter,
  codex: async () => (await import('./codex')).codexAdapter,
  opencode: async () => (await import('./opencode')).opencodeAdapter,
  copilot: async () => (await import('./copilot')).copilotAdapter,
  pi: async () => (await import('./pi')).piAdapter,
  lmstudio: async () => (await import('./lmstudio')).lmstudioAdapter,
  'claude-acp': async () => (await import('./acp')).claudeAcpAdapter,
  'codex-acp': async () => (await import('./acp')).codexAcpAdapter,
}

/** Capability flag → the adapter method that has to back it. */
const CAPABILITY_METHODS: Partial<Record<keyof SessionCapabilities, keyof SessionAdapter>> = {
  deleteSession: 'deleteSession',
}

function assertCapabilitiesMatchAdapter(provider: AgentProvider, adapter: SessionAdapter): void {
  const capabilities = getProviderCapabilities(provider)
  const mismatches: string[] = []
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
  if (mismatches.length > 0) {
    throw new Error(`Provider capability/adapter mismatch:\n  ${mismatches.join('\n  ')}`)
  }
}

// Cache the resolved adapter *and* the in-flight promise, so concurrent reads
// for the same provider share one module evaluation rather than racing.
const resolved = new Map<AgentProvider, SessionAdapter>()
const loading = new Map<AgentProvider, Promise<SessionAdapter>>()

export async function getSessionAdapter(provider: AgentProvider): Promise<SessionAdapter> {
  const cached = resolved.get(provider)
  if (cached) return cached
  const inFlight = loading.get(provider)
  if (inFlight) return inFlight
  const loader = ADAPTER_LOADERS[provider]
  if (!loader) throw new Error(`No session adapter registered for provider "${provider}"`)
  const promise = loader()
    .then((adapter) => {
      assertCapabilitiesMatchAdapter(provider, adapter)
      resolved.set(provider, adapter)
      return adapter
    })
    .finally(() => { loading.delete(provider) })
  loading.set(provider, promise)
  return promise
}

/** Loads every adapter and checks each against its declared capabilities — the
 *  whole-table version of the guard that used to run at module load. Called by
 *  `npm run adapters:smoke`; deliberately not called at import time, because
 *  doing so would reinstate the eager cost this module exists to avoid. */
export async function assertAllAdapterCapabilities(): Promise<void> {
  await Promise.all(
    (Object.keys(ADAPTER_LOADERS) as AgentProvider[]).map((provider) => getSessionAdapter(provider)),
  )
}

/** Raises the way the pre-adapter branch did: naming the provider and the op,
 *  so a missing method reads as "this provider can't do that" rather than as a
 *  generic undefined-is-not-a-function further up the stack. */
export function unsupported(provider: AgentProvider, op: keyof SessionAdapter): never {
  throw new Error(`${String(op)} is not supported for ${provider} sessions`)
}
