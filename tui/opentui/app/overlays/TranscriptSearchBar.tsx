/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import React from 'react'
import { fitText } from '../../textLayout'
import { SEARCH_MAX_CHARS } from '../timing'

export function TranscriptSearchBar({ searchMode, width, theme, searchMatches, searchMatchIndex, searchQuery, setSearchQuery, jumpToTranscriptIndex, setSearchMode }: {
  searchMode: boolean
  width: number
  theme: TuiThemePalette
  searchMatches: number[]
  searchMatchIndex: number
  searchQuery: string
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>
  jumpToTranscriptIndex: (index: number) => void
  setSearchMode: React.Dispatch<React.SetStateAction<boolean>>
}) {
  return (
    searchMode ? (
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
                  `SEARCH  ${searchMatches.length === 0 ? 'no matches' : `${searchMatchIndex + 1}/${searchMatches.length} matches`}  enter jump  esc close`,
                  width - 6,
                )}
              </text>
            </box>
            <box paddingX={1} height={1}>
              <input
                focused
                value={searchQuery}
                placeholder="Type to search transcript..."
                maxLength={SEARCH_MAX_CHARS}
                onInput={setSearchQuery}
                onSubmit={() => {
                  if (searchMatches.length > 0) jumpToTranscriptIndex(searchMatches[searchMatchIndex] ?? 0)
                  setSearchMode(false)
                }}
              />
            </box>
          </box>
        </box>
      ) : null
  )
}
