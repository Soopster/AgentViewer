import type { PluginMessagingService } from '../../lib/plugins/messaging'
import type { AddressableSession, SendCrossSessionMessageResult } from '../../lib/crossSessionMessagingTypes'

export const webMessaging: PluginMessagingService = {
  async list(exclude, signal) {
    const query = exclude ? `?exclude=${encodeURIComponent(exclude)}` : ''
    const response = await fetch(`/api/agents${query}`, { cache: 'no-store', signal })
    const data = await response.json() as { sessions?: AddressableSession[]; error?: string }
    if (!response.ok) throw new Error(data.error || `Session discovery failed with HTTP ${response.status}`)
    return data.sessions ?? []
  },
  async send({ toName, ...params }, signal) {
    const response = await fetch('/api/agents/message', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toName, ...params }),
    })
    const data = await response.json() as SendCrossSessionMessageResult
    if (!response.ok) throw new Error(data.error || `Delivery failed with HTTP ${response.status}`)
    return data
  },
}
