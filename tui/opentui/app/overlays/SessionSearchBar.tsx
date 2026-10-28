/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import React from 'react'
import { type Session } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { type SidebarEntry } from '../types'
import { SEARCH_MAX_CHARS } from '../timing'
import { sessionKey, sidebarEntrySession } from '../sessionList'

export function SessionSearchBar({ sessionSearchMode, width, theme, filteredSessionsForSidebar, sessions, sessionSearchQuery, setSessionSearchQuery, sidebarEntries, setSelectedSessionKey, setSessionSearchMode }: {
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
}) {
  return (
    sessionSearchMode ? (
        <box paddingX={1}>
          <box
            width={Math.max(width - 2, 20)}
            height={4}
            border
            borderStyle="single"
            borderColor={theme.border2}
            backgroundColor={theme.surface}
            flexDirection="column"
          >
            <box paddingX={1} height={1}>
              <text fg={theme.dim}>
                {fitText(
                  `SESSION SEARCH  ${filteredSessionsForSidebar.length}/${sessions.length} matches  enter select  esc clear`,
                  width - 6,
                )}
              </text>
            </box>
            <box paddingX={1} height={1}>
              <input
                focused
                value={sessionSearchQuery}
                placeholder="Type to filter sessions..."
                maxLength={SEARCH_MAX_CHARS}
                onInput={setSessionSearchQuery}
                onSubmit={() => {
                  const firstSession = sidebarEntries
                    .map(sidebarEntrySession)
                    .find((session): session is Session => Boolean(session))
                  if (firstSession) {
                    setSelectedSessionKey(sessionKey(firstSession))
                  }
                  setSessionSearchMode(false)
                }}
              />
            </box>
          </box>
        </box>
      ) : null
  )
}
