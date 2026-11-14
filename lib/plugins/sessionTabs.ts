// The session tab strip as a plugin service: the open tabs in order, which are
// pinned (pinned tabs lead and cannot be closed until unpinned), and pinning,
// moving, closing and selecting one. Each renderer backs it with its own strip.
import type { Session } from '../types'

export type PluginSessionTabs = {
  readonly sessions: readonly Session[]
  /** Keys (as `keyOf` makes them) of the pinned tabs. */
  readonly pinned: ReadonlySet<string>
  readonly selectedKey: string | null
  readonly keyOf: (session: Session) => string
  /** False when the host refused (the TUI keeps a cap on pinned tabs). */
  readonly togglePin: (session: Session) => boolean
  readonly move: (session: Session, delta: -1 | 1) => void
  readonly close: (session: Session) => void
  readonly select: (session: Session) => void
  /** TUI: pinned tabs on a row of their own above the strip. */
  readonly row?: boolean
  readonly toggleRow?: () => boolean
}
