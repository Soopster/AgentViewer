'use client'

import { createContext } from 'react'
import type { SessionTeamAttention } from './types'

// The provider label repeats on every row, which is pure noise when the list
// holds a single provider — the common case. Provided once per list rather than
// threaded through ProjectGroup/SessionRowGroup as a prop.
export const ShowProviderContext = createContext(true)

// Passed by context rather than as a row prop: a new object per poll would
// break every memoized row, and this changes only when a team does.
export const EMPTY_TEAM_ATTENTION: Record<string, SessionTeamAttention> = {}

export const TeamAttentionContext = createContext<Record<string, SessionTeamAttention>>(EMPTY_TEAM_ATTENTION)

/** The rail's row behaviour, provided once: compact one-row entries, and the right-click session menu. */
export type SidebarRowsValue = {
  compact: boolean
  openMenu: (session: import('@/lib/types').Session, point: { x: number; y: number }) => void
  /** A session whose title should open for renaming (the menu's Rename), or null. */
  renameKey: string | null
  clearRename: () => void
}
export const SidebarRowsContext = createContext<SidebarRowsValue>({ compact: false, openMenu: () => {}, renameKey: null, clearRename: () => {} })
