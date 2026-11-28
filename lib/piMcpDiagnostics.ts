import type { AgentSession, EventBus } from '@earendil-works/pi-coding-agent'
import { scrubCardText } from './plugins/cardBlocks'

const readers = new WeakMap<AgentSession, () => string[] | undefined>()
const statuses = new Set(['connected', 'cached', 'failed', 'needs-auth', 'not-connected', 'disabled'])

export function observePiMcpStatus(bus: EventBus) {
  let inventory: string[] | undefined
  bus.on('pi-mcp-adapter/status/v1', (payload) => {
    if (!payload || typeof payload !== 'object') return
    const { version, servers } = payload as Record<string, unknown>
    if (version !== 1 || !Array.isArray(servers)) return
    const rows = servers.slice(0, 500).flatMap(server => {
      if (!server || typeof server.name !== 'string' || !statuses.has(server.status)) return []
      const name = scrubCardText(server.name, 160).replace(/\s+/g, ' ').trim()
      if (!name) return []
      const count = Number.isSafeInteger(server.toolCount) && server.toolCount >= 0 ? ` · ${server.toolCount} tools` : ''
      return [`${name} · ${server.status}${count}`]
    })
    inventory = rows.length ? rows : ['None']
  })
  return (session: AgentSession) => { readers.set(session, () => inventory) }
}

export function readPiMcpStatus(session: AgentSession): string[] | undefined {
  return readers.get(session)?.()
}
