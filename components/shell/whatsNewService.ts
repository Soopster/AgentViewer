import type { PluginWhatsNewService } from '../../lib/plugins/whatsNew'
import type { WhatsNew } from '../../lib/whatsNew'

// The server reads its own repository: a directory named by a client would let a
// paired read-only device probe any path the daemon can see, so `cwd` is not sent.
export function createWebWhatsNewService(fetcher: typeof fetch = (...args) => fetch(...args)): PluginWhatsNewService {
  return {
    async read(options, signal) {
      const query = options?.limit ? `?limit=${encodeURIComponent(String(options.limit))}` : ''
      const response = await fetcher(`/api/whats-new${query}`, { signal })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.error) throw new Error(body.error || `Could not read the history (${response.status})`)
      return body as WhatsNew
    },
  }
}

export const webWhatsNew = createWebWhatsNewService()
