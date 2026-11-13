// The `mod` provider's backend: agent backends supplied by the user's mods.
//
// A mod becomes a provider by declaring `"provider": { "displayName": … }` in
// its plugin.json and exporting `provider` from its server module:
//
//   export const provider = {
//     async listSessions() { return [{ id, title?, cwd?, updatedAt? }] },
//     async readMessages(id) { return [{ id?, role: 'user' | 'assistant', text, at? }] },
//     async createSession({ cwd, title }) { return { id } },
//     async *sendTurn({ sessionId, message, history, signal }) { yield 'text…' },
//     async deleteSession(id) {},   // optional
//   }
//
// The mod owns its sessions and persists both sides of each turn; this app
// lists, reads and streams them. Each provider mod is an instance of `mod`
// (`mod-<plugin id>`), so the provider menu, the session rows and the composer
// treat it like any other agent — and two mods can never read each other's
// sessions, because every call is routed by the instance that listed them.
import { localPluginDiscovery } from './plugins/localPlugins'
import { isPluginEnabled } from './plugins/enablement'
import type { SessionMessage } from './types'

export type ModProviderSession = { id: string; title?: string; cwd?: string; updatedAt?: number | string; createdAt?: number | string }
export type ModProviderMessage = { id?: string; role: 'user' | 'assistant'; text: string; at?: number | string }
export type ModProviderModule = {
  listSessions(): Promise<ModProviderSession[]> | ModProviderSession[]
  readMessages(sessionId: string): Promise<ModProviderMessage[]> | ModProviderMessage[]
  createSession(options: { cwd: string; title?: string }): Promise<{ id: string }> | { id: string }
  sendTurn(options: { sessionId: string; message: string; history: ModProviderMessage[]; signal: AbortSignal }): AsyncIterable<string> | Promise<string> | string
  deleteSession?(sessionId: string): Promise<void> | void
}

export const MOD_INSTANCE_PREFIX = 'mod-'

/** Every enabled mod that declares a provider, as an instance of `mod`. */
export function listModProviderInstances(): Array<{ id: string; pluginId: string; displayName: string }> {
  return localPluginDiscovery().plugins
    .filter(plugin => plugin.manifest.localProvider && isPluginEnabled(plugin.manifest.id))
    .map(plugin => ({ id: `${MOD_INSTANCE_PREFIX}${plugin.manifest.id}`, pluginId: plugin.manifest.id, displayName: plugin.manifest.localProvider!.displayName }))
}

/**
 * The provider module the current request is scoped to: the instance's mod, or
 * for the default `mod` instance the first provider mod (null when there is none).
 */
export async function currentModProvider(executable: string | undefined): Promise<{ pluginId: string; provider: ModProviderModule } | null> {
  const instances = listModProviderInstances()
  const pluginId = executable && instances.some(instance => instance.pluginId === executable) ? executable : instances[0]?.pluginId
  if (!pluginId) return null
  const { loadLocalPluginModule } = await import('./plugins/localPluginRuntime')
  const exported = await loadLocalPluginModule(pluginId)
  const provider = exported.provider as ModProviderModule | undefined
  if (!provider || typeof provider.listSessions !== 'function' || typeof provider.readMessages !== 'function'
    || typeof provider.createSession !== 'function' || typeof provider.sendTurn !== 'function') {
    throw new Error(`Mod "${pluginId}" declares a provider but its server module exports no complete \`provider\` (listSessions, readMessages, createSession, sendTurn)`)
  }
  return { pluginId, provider }
}

export function modTimestamp(value: number | string | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : undefined }
  return undefined
}

/** A mod's messages as the shared wire format; ids are stable when the mod gives none. */
export function mapModMessages(sessionId: string, messages: ModProviderMessage[]): SessionMessage[] {
  return messages.filter(message => (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string').map((message, index) => {
    const at = modTimestamp(message.at)
    return {
      type: message.role,
      uuid: message.id ?? `${sessionId}:${index}`,
      session_id: sessionId,
      parent_tool_use_id: null,
      ...(at ? { timestamp: new Date(at).toISOString() } : {}),
      message: { role: message.role, content: message.role === 'assistant' ? [{ type: 'text', text: message.text }] : message.text },
      provider: 'mod',
    } as SessionMessage
  })
}
