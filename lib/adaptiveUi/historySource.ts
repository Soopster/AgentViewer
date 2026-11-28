// The sessions on this machine, as a HistorySource for the corpus scan: every enabled provider's sessions
// through its own read adapter (the same path the transcript uses), newest first, read raw so the plugin
// hooks do not run over them (a backfill must not count itself as live use).
import type { HistorySource } from './corpus'

const PAGE = 200
const PER_PROVIDER_MAX = 1_000

export function createLocalHistorySource(): HistorySource {
  return {
    async list() {
      const [{ PROVIDER_IDS }, { getSessionAdapter }] = await Promise.all([import('../extensions/providers/catalog'), import('../adapters/registry')])
      const out: { key: string; lastModified: number }[] = []
      for (const provider of PROVIDER_IDS) {
        try {
          const adapter = await getSessionAdapter(provider)
          if (!adapter.listSessions || !adapter.readAllMessages) continue
          for (let offset = 0; offset < PER_PROVIDER_MAX; offset += PAGE) {
            const page = await adapter.listSessions({ limit: PAGE, offset })
            for (const session of page) out.push({ key: `${provider}:${session.sessionId}`, lastModified: session.lastModified ?? 0 })
            if (page.length < PAGE) break
          }
        } catch { /* a provider that is off, missing or cannot list contributes nothing */ }
      }
      return out
    },
    async read(session) {
      const split = session.key.indexOf(':')
      const provider = session.key.slice(0, split) as import('../types').AgentProvider, sessionId = session.key.slice(split + 1)
      const { getSessionAdapter } = await import('../adapters/registry')
      const adapter = await getSessionAdapter(provider)
      const { messages } = await adapter.readAllMessages!(sessionId)
      return messages.map(message => ({ message: message.message, ...(message.timestamp ? { timestamp: message.timestamp } : {}) }))
    },
  }
}
