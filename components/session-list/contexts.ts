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
