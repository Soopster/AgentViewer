import type { GitData } from '../../lib/gitProvider'
import type { PluginHandoffService } from '../../lib/plugins/handoff'

export function createWebHandoffService(fetcher: typeof fetch = (...args) => fetch(...args)): PluginHandoffService {
  return {
    async readGit(cwd, signal) {
      const response = await fetcher(`/api/git?cwd=${encodeURIComponent(cwd)}&action=data`, { signal })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.error || !body.data) throw new Error(body.error || `Could not read git (${response.status})`)
      return body.data as GitData
    },
    async bookmarkIds(session, signal) {
      const query = session.provider ? `?provider=${encodeURIComponent(session.provider)}` : ''
      const response = await fetcher(`/api/sessions/${encodeURIComponent(session.sessionId)}/bookmarks${query}`, { signal })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.error) throw new Error(body.error || `Could not read bookmarks (${response.status})`)
      return Array.isArray(body.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string') : []
    },
  }
}

export const webHandoff = createWebHandoffService()
