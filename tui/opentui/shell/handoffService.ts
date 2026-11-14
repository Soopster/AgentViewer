import { fetchGitData } from '../../../lib/gitProvider'
import { runGitCommand } from '../../../lib/gitNodeProvider'
import { readTuiSessionBookmarkIds } from '../../../lib/tui/service'
import type { PluginHandoffService } from '../../../lib/plugins/handoff'

/** In-process reads; git and the bookmark store are both local to the TUI. */
export const tuiHandoff: PluginHandoffService = {
  async readGit(cwd, signal) {
    signal?.throwIfAborted()
    const data = await fetchGitData(cwd, runGitCommand)
    signal?.throwIfAborted()
    return data
  },
  async bookmarkIds(session, signal) {
    signal?.throwIfAborted()
    return readTuiSessionBookmarkIds(session)
  },
}
