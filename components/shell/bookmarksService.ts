import type { MessageBookmark } from '../../lib/messageBookmarks'
import type { PluginBookmarksService } from '../../lib/plugins/bookmarks'

export function createWebBookmarksService(fetcher: typeof fetch = (...args) => fetch(...args)): PluginBookmarksService {
  return {
    async list(signal) {
      const response = await fetcher('/api/bookmarks', { signal })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !Array.isArray(body?.bookmarks)) throw new Error(body?.error || 'Failed to load bookmarks')
      return body.bookmarks as MessageBookmark[]
    },
    async remove(bookmark) {
      const response = await fetcher(`/api/sessions/${encodeURIComponent(bookmark.sessionId)}/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: bookmark.provider, uuid: bookmark.uuid, bookmarked: false }),
      })
      if (!response.ok) throw new Error(`Could not remove the bookmark (${response.status})`)
    },
  }
}

export const webBookmarks = createWebBookmarksService()
