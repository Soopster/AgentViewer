/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type Session } from '../../../../lib/types'
import { type SidebarEntry } from '../types'
import { SessionSearchBar } from './SessionSearchBar'

type ComposerStatusStackProps = {
  sessionSearchMode: boolean
  width: number
  theme: TuiThemePalette
  filteredSessionsForSidebar: Session[]
  sessions: Session[]
  sessionSearchQuery: string
  setSessionSearchQuery: React.Dispatch<React.SetStateAction<string>>
  sidebarEntries: SidebarEntry[]
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setSessionSearchMode: React.Dispatch<React.SetStateAction<boolean>>
}

export function ComposerStatusStack(props: ComposerStatusStackProps) {
  const {
    sessionSearchMode, width, theme, filteredSessionsForSidebar, sessions, sessionSearchQuery,
    setSessionSearchQuery, sidebarEntries, setSelectedSessionKey, setSessionSearchMode,
  } = props
  return (
    (
<SessionSearchBar sessionSearchMode={sessionSearchMode} width={width} theme={theme} filteredSessionsForSidebar={filteredSessionsForSidebar} sessions={sessions} sessionSearchQuery={sessionSearchQuery} setSessionSearchQuery={setSessionSearchQuery} sidebarEntries={sidebarEntries} setSelectedSessionKey={setSelectedSessionKey} setSessionSearchMode={setSessionSearchMode} />
)
  )
}
