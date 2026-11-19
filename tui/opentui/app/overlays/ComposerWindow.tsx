/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { QuietWorkspaceState } from '../../workspaceContext'
import React from 'react'
import { type TextareaRenderable } from '@opentui/core'
import { fitText } from '../../textLayout'
import { type InlineTextSegment, renderInlineTextSegments, DraftLengthSpans } from '../inlineText'
import { fitHintText } from '../contextMeter'

type ComposerWindowProps = {
  composerWindowOpen: boolean
  presentationHidesComposer: boolean
  composerWindowTop: number
  composerWindowLeft: number
  composerWindowWidth: number
  composerWindowHeight: number
  composerAccentColor: string
  theme: TuiThemePalette
  composerWindowBorderTitle: string
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerWindowHeaderHeight: 2
  composerWindowMetaSegments: InlineTextSegment[]
  composerWindowContentWidth: number
  composerWindowEditorHeight: number
  renderComposerTextarea: (onSubmit: () => void, options?: { height?: number; width?: number; variant?: 'chat'; background?: string; }) => React.ReactNode
  submitComposerFromWindow: () => void
  composerWindowTextareaWidth: number
  renderComposerMentionPanel: (panelWidth: number, rowWidth: number) => React.ReactNode
  composerHistoryOpen: boolean
  composerStashOpen: boolean
  renderComposerSlashPanel: (panelWidth: number, rowWidth: number) => React.ReactNode
  renderComposerHistoryPanel: (panelWidth: number, rowWidth: number) => React.ReactNode
  renderComposerStashPanel: (panelWidth: number, rowWidth: number) => React.ReactNode
  renderComposerRewindPanel: (panelWidth: number, rowWidth: number) => React.ReactNode
  renderComposerQueuePanel: (panelWidth: number, rowWidth: number) => React.ReactNode
  composerWindowFooterHeight: 2
  composerWindowFooterStatsWidth: number
  composerSlashHint: string
  composerDraftState: QuietWorkspaceState
  composerWindowDraftFor: (draftLength: number) => InlineTextSegment[]
  composerWindowFooterHintWidth: number
  composerWindowSendingHintSegments: InlineTextSegment[] | null
  composerWindowFooterHint: string
}

export function ComposerWindow(props: ComposerWindowProps) {
  const {
    composerWindowOpen, presentationHidesComposer, composerWindowTop, composerWindowLeft,
    composerWindowWidth, composerWindowHeight, composerAccentColor, theme,
    composerWindowBorderTitle, composerTextareaRef, composerWindowHeaderHeight,
    composerWindowMetaSegments, composerWindowContentWidth, composerWindowEditorHeight,
    renderComposerTextarea, submitComposerFromWindow, composerWindowTextareaWidth,
    renderComposerMentionPanel, composerHistoryOpen, composerStashOpen, renderComposerSlashPanel,
    renderComposerHistoryPanel, renderComposerStashPanel, renderComposerRewindPanel,
    renderComposerQueuePanel, composerWindowFooterHeight, composerWindowFooterStatsWidth,
    composerSlashHint, composerDraftState, composerWindowDraftFor, composerWindowFooterHintWidth,
    composerWindowSendingHintSegments, composerWindowFooterHint,
  } = props
  return (
    composerWindowOpen && !presentationHidesComposer ? (
        <box
          position="absolute"
          top={composerWindowTop}
          left={composerWindowLeft}
          width={composerWindowWidth}
          height={composerWindowHeight}
          border
          borderStyle="heavy"
          borderColor={composerAccentColor}
          backgroundColor={theme.surface2}
          zIndex={60}
          flexDirection="column"
          title={composerWindowBorderTitle}
          titleColor={composerAccentColor}
          titleAlignment="left"
          onMouseDown={(event) => {
            if (event.button !== 0) return
            composerTextareaRef.current?.focus()
          }}
        >
          <box
            height={composerWindowHeaderHeight}
            paddingX={1}
            border={['bottom']}
            borderStyle="single"
            borderColor={theme.border}
            backgroundColor={theme.surface2}
            flexDirection="row"
            alignItems="center"
          >
            <text fg={theme.dim} wrapMode="none">
              {renderInlineTextSegments(composerWindowMetaSegments, composerWindowContentWidth, theme.dim)}
            </text>
          </box>

          <box
            height={composerWindowEditorHeight}
            paddingX={1}
            paddingY={1}
            flexDirection="column"
            overflow="hidden"
            backgroundColor={theme.surface}
          >
            {renderComposerTextarea(submitComposerFromWindow, {
              height: Math.max(composerWindowEditorHeight - 2, 2),
              width: composerWindowTextareaWidth,
            })}
          </box>

          {renderComposerMentionPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12))}
          {!composerHistoryOpen && !composerStashOpen ? renderComposerSlashPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12)) : null}
          {renderComposerHistoryPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12))}
          {renderComposerStashPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12))}
          {renderComposerRewindPanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12))}
          {!composerHistoryOpen && !composerStashOpen ? renderComposerQueuePanel(composerWindowContentWidth, Math.max(composerWindowContentWidth - 4, 12)) : null}

          <box
            height={composerWindowFooterHeight}
            paddingX={1}
            border={['top']}
            borderStyle="single"
            borderColor={theme.border}
            backgroundColor={theme.surface2}
            flexDirection="row"
            alignItems="center"
          >
            <box width={composerWindowFooterStatsWidth} overflow="hidden">
              <text fg={composerSlashHint ? composerAccentColor : theme.dim} wrapMode="none">
                {composerSlashHint
                  ? fitText(composerSlashHint, composerWindowFooterStatsWidth)
                  : <DraftLengthSpans draft={composerDraftState} build={composerWindowDraftFor} width={composerWindowFooterStatsWidth} padFg={theme.dim} />}
              </text>
            </box>
            <box flexGrow={1} />
            <box width={composerWindowFooterHintWidth} overflow="hidden">
              <text fg={theme.dim} wrapMode="none">
                {composerWindowSendingHintSegments
                  ? renderInlineTextSegments(composerWindowSendingHintSegments, composerWindowFooterHintWidth, theme.dim)
                  : fitHintText(composerWindowFooterHint, composerWindowFooterHintWidth)}
              </text>
            </box>
          </box>
        </box>
      ) : null
  )
}
