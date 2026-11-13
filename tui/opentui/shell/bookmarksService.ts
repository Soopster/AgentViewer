import { readTuiAllBookmarks, toggleTuiSessionBookmark } from '../../../lib/tui/service'
import type { PluginBookmarksService } from '../../../lib/plugins/bookmarks'
import type { Session } from '../../../lib/types'

export const tuiBookmarks: PluginBookmarksService = {
  async list(signal) {
    signal?.throwIfAborted()
    return readTuiAllBookmarks()
  },
  async remove(bookmark) {
    await toggleTuiSessionBookmark({ sessionId: bookmark.sessionId, provider: bookmark.provider } as Session, bookmark.uuid, false)
  },
}
