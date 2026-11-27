import type { PluginSessionRef } from './bookmarks'

/** What the activity list may ask its host to do. Each call rejects with a reason a person can read. */
export type PluginActivityControl = {
  readonly interrupt: (target: PluginSessionRef) => Promise<void>
  readonly stopTask: (target: PluginSessionRef, taskId: string) => Promise<void>
  readonly rerunChecks: (cwd: string, ids: readonly string[], version: string) => Promise<void>
  /** Opens the session and adds text to its composer. It never sends; empty text only opens the composer. */
  readonly draft: (target: PluginSessionRef | undefined, text: string) => void
  /** Opens the session, then runs a plugin command there. */
  readonly open: (commandId: string, target: PluginSessionRef | undefined) => void
}
