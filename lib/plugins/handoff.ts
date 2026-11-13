import type { GitData } from '../gitProvider'
import type { Session } from '../types'

/** What a handoff brief reads beyond the transcript: the checkout's state and the session's bookmarks. */
export type PluginHandoffService = {
  readonly readGit: (cwd: string, signal?: AbortSignal) => Promise<GitData>
  readonly bookmarkIds: (session: Session, signal?: AbortSignal) => Promise<readonly string[]>
}
