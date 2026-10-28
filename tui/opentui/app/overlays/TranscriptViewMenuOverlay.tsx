/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import React from 'react'
import { type TuiTranscriptView } from '../../../theme'
import { TRANSCRIPT_VIEWS, TRANSCRIPT_VIEW_LABELS, TRANSCRIPT_VIEW_DESCRIPTIONS } from '../commands'

export function TranscriptViewMenuOverlay({ transcriptViewMenuOpen, width, transcriptViewMenuOriginRef, focusMode, theme, transcriptViewMenuIndex, setTranscriptViewMenuIndex, setTranscriptView, chooseTranscriptView, lightweightWindows }: {
  transcriptViewMenuOpen: boolean
  width: number
  transcriptViewMenuOriginRef: React.RefObject<TuiTranscriptView | null>
  focusMode: boolean
  theme: TuiThemePalette
  transcriptViewMenuIndex: number
  setTranscriptViewMenuIndex: React.Dispatch<React.SetStateAction<number>>
  setTranscriptView: React.Dispatch<React.SetStateAction<TuiTranscriptView>>
  chooseTranscriptView: (nextView: TuiTranscriptView) => void
  lightweightWindows: boolean
}) {
  return (
    transcriptViewMenuOpen ? (() => {
          const menuWidth = Math.min(Math.max(width - 8, 28), 46)
          const menuHeight = 11
          const originView = transcriptViewMenuOriginRef.current
          const viewOptions = TRANSCRIPT_VIEWS.map((view) => ({
            name: TRANSCRIPT_VIEW_LABELS[view] + (view === originView ? ' ✓' : ''),
            description: TRANSCRIPT_VIEW_DESCRIPTIONS[view],
            value: view,
          }))
          return (
            <box
              position="absolute"
              top={focusMode ? 1 : 3}
              right={2}
              width={menuWidth}
              height={menuHeight}
              border
              borderStyle="single"
              borderColor={theme.border2}
              backgroundColor={theme.surface}
              zIndex={20}
              flexDirection="column"
            >
              <box paddingX={2} paddingBottom={1} flexDirection="row">
                <text fg={theme.cyan} wrapMode="none">TRANSCRIPT VIEW</text>
                <text fg={theme.dim} wrapMode="none">  v / esc close</text>
              </box>
              <box flexGrow={1} paddingX={1} paddingBottom={1}>
                <select
                  style={{ height: menuHeight - 5 }}
                  focused
                  options={viewOptions}
                  selectedIndex={transcriptViewMenuIndex}
                  selectedBackgroundColor={theme.surface3}
                  selectedTextColor={theme.text}
                  textColor={theme.muted}
                  descriptionColor={theme.dim}
                  selectedDescriptionColor={theme.cyan}
                  backgroundColor={theme.surface}
                  focusedBackgroundColor={theme.surface}
                  showScrollIndicator={false}
                  showDescription={false}
                  itemSpacing={0}
                  onChange={(index) => {
                    const next = TRANSCRIPT_VIEWS[index]
                    if (next) {
                      setTranscriptViewMenuIndex(index)
                      setTranscriptView(next)
                    }
                  }}
                  onSelect={(_, option) => {
                    const next = option?.value as TuiTranscriptView | undefined
                    if (next) chooseTranscriptView(next)
                  }}
                />
              </box>
              <box id="transcript-view-lightweight" height={1} paddingX={2} flexDirection="row">
                <text fg={theme.cyan} wrapMode="none">tab </text>
                <text fg={lightweightWindows ? theme.text : theme.muted} wrapMode="none">
                  {lightweightWindows ? '● lightweight windows' : '○ lightweight windows'}
                </text>
              </box>
            </box>
          )
        })() : null
  )
}
