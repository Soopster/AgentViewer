// Read path for the `mod` provider: sessions are whatever the instance's mod
// says they are (lib/modProvider.ts). No mod for this instance is an empty
// list, never an error — the sidebar polls every provider.
import { currentProviderExecutable } from '../../../providerInstances'
import { currentModProvider, mapModMessages, modTimestamp, type ModProviderSession } from '../../../modProvider'
import { getProviderManifest } from '../catalog'
import type { Session, SessionInfo } from '../../../types'
import type { SessionAdapter } from '../../../adapters/types'

const capabilities = getProviderManifest('mod').capabilities

function toSession(session: ModProviderSession, firstPrompt?: string): Session {
  return {
    sessionId: session.id,
    summary: session.title ?? firstPrompt ?? 'Mod session',
    ...(session.title ? { customTitle: session.title } : {}),
    ...(firstPrompt ? { firstPrompt } : {}),
    lastModified: modTimestamp(session.updatedAt) ?? modTimestamp(session.createdAt) ?? Date.now(),
    ...(session.cwd ? { cwd: session.cwd } : {}),
    provider: 'mod',
    capabilities,
  } as Session
}

export const adapter: SessionAdapter = {
  provider: 'mod',

  async listSessions({ limit, offset, dir }) {
    const mod = await currentModProvider(currentProviderExecutable(''))
    if (!mod) return []
    const sessions = await mod.provider.listSessions()
    const filtered = (Array.isArray(sessions) ? sessions : []).filter(session => typeof session?.id === 'string' && (!dir || session.cwd === dir))
    filtered.sort((a, b) => (modTimestamp(b.updatedAt) ?? 0) - (modTimestamp(a.updatedAt) ?? 0))
    return filtered.slice(offset, offset + limit).map(session => toSession(session))
  },

  async readSessionInfo(sessionId) {
    const mod = await currentModProvider(currentProviderExecutable(''))
    if (!mod) return null
    const session = (await mod.provider.listSessions()).find(entry => entry.id === sessionId)
    if (!session) return null
    const messages = await mod.provider.readMessages(sessionId)
    const firstPrompt = messages.find(message => message.role === 'user')?.text
    const base = toSession(session, firstPrompt)
    return { ...base, lastModified: base.lastModified ?? Date.now(), summary: base.summary ?? 'Mod session', currentModel: mod.pluginId } as SessionInfo
  },

  async readAllMessages(sessionId) {
    const mod = await currentModProvider(currentProviderExecutable(''))
    if (!mod) throw new Error('No provider mod is installed for this instance')
    return { messages: mapModMessages(sessionId, await mod.provider.readMessages(sessionId)) }
  },
}
