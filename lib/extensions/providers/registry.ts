// Server-only loaders: do not import this module from UI metadata consumers.
import type { AgentProvider, SessionCapabilities } from '../../types'
import type { SessionAdapter } from '../../adapters/types'
import type { ProviderExtension, ProviderRuntime } from './types'
import { getProviderManifest, PROVIDER_IDS } from './catalog'
import { createLazyRegistry } from '../lazyRegistry'
import { registerProviderPendingTurnPayloadReader } from '../../sessionActivity'
import { registerProviderDiagnostics } from '../../providerDiagnostics'

// Static import specifiers let both Next and Bun discover bundled extensions.
const loaders = {
  'claude': async () => (await import('./claude/server')).extension,
  'codex': async () => (await import('./codex/server')).extension,
  'opencode': async () => (await import('./opencode/server')).extension,
  'copilot': async () => (await import('./copilot/server')).extension,
  'pi': async () => (await import('./pi/server')).extension,
  'lmstudio': async () => (await import('./lmstudio/server')).extension,
  'claude-acp': async () => (await import('./claude-acp/server')).extension,
  'codex-acp': async () => (await import('./codex-acp/server')).extension,
  'acp': async () => (await import('./acp/server')).extension,
} satisfies Record<AgentProvider, () => Promise<ProviderExtension>>

const extensions = createLazyRegistry<AgentProvider, ProviderExtension>(loaders, (id, extension) => {
  const expected = getProviderManifest(id)
  if (extension.manifest !== expected || extension.manifest.apiVersion !== 1) {
    throw new Error(`Provider extension manifest/version mismatch: ${id}`)
  }
})

const capabilityMethods: Partial<Record<keyof SessionCapabilities, keyof SessionAdapter>> = {
  deleteSession: 'deleteSession',
}

const adapters = createLazyRegistry<AgentProvider, SessionAdapter>(
  Object.fromEntries(PROVIDER_IDS.map(id => [id, async () => (await extensions.get(id)).loadAdapter()])) as Record<AgentProvider, () => Promise<SessionAdapter>>,
  (id, adapter) => {
    if (adapter.provider !== id) throw new Error(`Provider adapter identity mismatch: ${id}`)
    const capabilities = getProviderManifest(id).capabilities
    for (const [flag, method] of Object.entries(capabilityMethods) as Array<[keyof SessionCapabilities, keyof SessionAdapter]>) {
      if (capabilities[flag] !== (typeof adapter[method] === 'function')) {
        throw new Error(`Provider capability/adapter mismatch: ${id}: ${flag} / ${method}`)
      }
    }
  },
)

const runtimes = createLazyRegistry<AgentProvider, ProviderRuntime>(
  Object.fromEntries(PROVIDER_IDS.map(id => [id, async () => (await extensions.get(id)).loadRuntime()])) as Record<AgentProvider, () => Promise<ProviderRuntime>>,
  (id, runtime) => {
    if (typeof runtime.createSession !== 'function' || typeof runtime.streamTurn !== 'function' || typeof runtime.closeSession !== 'function') {
      throw new Error(`Provider runtime is missing createSession/streamTurn/closeSession: ${id}`)
    }
    const capabilities = getProviderManifest(id).capabilities
    if (capabilities.messageFork && !runtime.forkSession) throw new Error(`Provider runtime is missing forkSession: ${id}`)
    if ((capabilities.fileRewind || capabilities.rollback) && !runtime.rewindSession) throw new Error(`Provider runtime is missing rewindSession: ${id}`)
    if (capabilities.respondToPermission && !runtime.runAction) throw new Error(`Provider runtime is missing runAction: ${id}`)
    registerProviderPendingTurnPayloadReader(id, {
      listPendingPrompts: sessionId => runtime.listPendingPrompts?.(sessionId) ?? [],
      listPendingPermissions: (sessionId, provider) => runtime.listPendingPermissions?.(sessionId, provider ?? id) ?? [],
    })
    if (runtime.getMemoryDiagnostics) registerProviderDiagnostics(`${id}:runtime`, runtime.getMemoryDiagnostics)
  },
)

export const getProviderExtension = extensions.get
export const getProviderRuntime = runtimes.get
export const getLoadedProviderRuntime = runtimes.peek
export const getSessionAdapter = adapters.get

export async function assertAllAdapterCapabilities(): Promise<void> {
  await Promise.all(PROVIDER_IDS.map(id => getSessionAdapter(id)))
}
