/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import type { ReactNode } from 'react'
import type { QuietWorkspaceState } from '../../workspaceContext'
import React from 'react'
import { type TextareaRenderable } from '@opentui/core'
import { type Session } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { TeammatesAttention } from '../../TeammatesAttention'
import { type InlineTextSegment, renderInlineTextSegments, DraftLengthSpans } from '../inlineText'
import { fitHintText } from '../contextMeter'
import { ComposerWaitingStatus } from '../chrome'
import { SectionFrame } from '../borders'

type ComposerDockProps = {
  composerWindowOpen: boolean
  composerHidden: boolean
  presentationHidesComposer: boolean
  embeddedComposer: boolean
  composerAreaOffset: number
  composerAreaWidth: number
  composerDockBackground: string
  fullscreenMode: boolean
  composerDockRouted: boolean
  isChatLikeView: boolean
  composerDockEmphasized: boolean
  composerAccentColor: string
  theme: TuiThemePalette
  composerTurnStatusInBorder: boolean
  composerTargetMessage: string | null
  composerDockTitleWidth: number
  composerDockBorderTitle: string
  composerDockHeight: number
  surfacePanelFocused: boolean
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  composerActive: boolean
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerDockTextareaWidth: number
  composerSendStartedAt: number | null
  composerWaitingStatusSeed: string
  composerWaitingSuffix: string | null
  composerWaitingOnUser: 'Waiting for your answer' | 'Waiting for your approval' | null
  renderComposerTextarea: (onSubmit: () => void, options?: { height?: number; width?: number; variant?: 'chat'; background?: string; }) => React.ReactNode
  submitComposerFromDock: () => void
  composerDockTextareaHeight: number
  composerDockFooterStatsWidth: number
  voiceStatus: string
  composerSlashHint: string
  clickComposerStatus: (event: { button: number; x: number; currentTarget: { x: number; } | null; stopPropagation: () => void; }, segments: InlineTextSegment[], width: number) => void
  dockFooterStatsFor: (draftLength: number) => InlineTextSegment[]
  composerDraftState: QuietWorkspaceState
  hoverComposerStatus: (site: 'chat' | 'dock', event: { x: number; currentTarget: { x: number; } | null; }, segments: InlineTextSegment[], width: number) => void
  setComposerStatusHover: React.Dispatch<React.SetStateAction<{ site: 'chat' | 'dock'; index: number; } | null>>
  composerStatusHover: { site: 'chat' | 'dock'; index: number; } | null
  dockShowsStatusBar: boolean
  selectedSession: Session | null
  composerDockFooterHintWidth: number
  visibleComposerSending: boolean
  footerSegments: InlineTextSegment[]
  composerDockSendingHintSegments: InlineTextSegment[] | null
  composerDockFooterHint: string
}

export function ComposerDock(props: ComposerDockProps) {
  const {
    composerWindowOpen, composerHidden, presentationHidesComposer, embeddedComposer,
    composerAreaOffset, composerAreaWidth, composerDockBackground, fullscreenMode,
    composerDockRouted, isChatLikeView, composerDockEmphasized, composerAccentColor, theme,
    composerTurnStatusInBorder, composerTargetMessage, composerDockTitleWidth,
    composerDockBorderTitle, composerDockHeight, surfacePanelFocused, setSurfacePanelFocused,
    composerActive, setComposerActive, composerTextareaRef, composerDockTextareaWidth,
    composerSendStartedAt, composerWaitingStatusSeed, composerWaitingSuffix, composerWaitingOnUser,
    renderComposerTextarea, submitComposerFromDock, composerDockTextareaHeight,
    composerDockFooterStatsWidth, voiceStatus, composerSlashHint, clickComposerStatus,
    dockFooterStatsFor, composerDraftState, hoverComposerStatus, setComposerStatusHover,
    composerStatusHover, dockShowsStatusBar, selectedSession, composerDockFooterHintWidth,
    visibleComposerSending, footerSegments, composerDockSendingHintSegments,
    composerDockFooterHint,
  } = props
  return (
    !composerWindowOpen && !composerHidden && !presentationHidesComposer && !embeddedComposer ? (
        <SectionFrame
          id="composer-dock"
          theme={theme}
          surface={composerDockBackground}
          marginLeft={composerAreaOffset}
          width={composerAreaWidth}
          paddingX={1}
          // The textarea paints theme.surface over its own cells; a dock in any
          // other shade showed as a padding stripe down each side and, with no
          // border in fullscreen, a band that did not match the draft.
          backgroundColor={composerDockBackground}
          border={fullscreenMode ? [] : ['top', 'left', 'right', 'bottom']}
          borderStyle={composerDockRouted ? 'heavy' : isChatLikeView ? 'single' : 'rounded'}
          borderColor={composerDockEmphasized ? composerAccentColor : theme.border}
          focused={composerDockEmphasized}
          title={fullscreenMode || composerTurnStatusInBorder ? undefined : composerTargetMessage
            ? fitText(composerTargetMessage, composerDockTitleWidth)
            : isChatLikeView ? undefined : composerDockBorderTitle}
          titleColor={composerTargetMessage ? theme.cyan : composerDockEmphasized ? composerAccentColor : theme.dim}
          titleAlignment="left"
          height={composerDockHeight}
          flexDirection="column"
          onMouseDown={(event) => {
            if (event.button !== 0) return
            if (surfacePanelFocused) setSurfacePanelFocused(false)
            if (!composerActive) setComposerActive(true)
            composerTextareaRef.current?.focus()
          }}
        >
          {composerTurnStatusInBorder ? (
            <box
              id="composer-dock-turn-status"
              position="absolute"
              top={-1}
              left={1}
              width={composerDockTextareaWidth}
              height={1}
              flexDirection="row"
              backgroundColor={composerDockBackground}
              overflow="hidden"
            >
              <box flexGrow={1} minWidth={0} overflow="hidden">
                <ComposerWaitingStatus
                  startedAt={composerSendStartedAt}
                  seed={composerWaitingStatusSeed}
                  suffix={composerWaitingSuffix}
                  theme={theme}
                  width={Math.max(1, composerDockTextareaWidth - (composerTargetMessage ? Math.min(36, Math.floor(composerDockTextareaWidth / 4)) + 3 : 0))}
                  message={composerWaitingOnUser}
                />
              </box>
              {composerTargetMessage ? (
                <text fg={theme.cyan} wrapMode="none" width={Math.min(36, Math.floor(composerDockTextareaWidth / 4)) + 3}>
                  {` · ${fitText(composerTargetMessage, Math.min(36, Math.floor(composerDockTextareaWidth / 4)))}`}
                </text>
              ) : null}
            </box>
          ) : null}
          {renderComposerTextarea(submitComposerFromDock, {
            height: composerDockTextareaHeight,
            width: composerDockTextareaWidth,
            background: composerDockBackground,
          })}
          {/* Stats and key hints sit *in* the bottom border rather than on a
              row above it — the same trick the top border's title uses, worth
              a whole row of draft back. Fullscreen has no border to sit in, so
              there it stays an ordinary flow row. */}
          <box
            id="composer-dock-status"
            {...(fullscreenMode
              // Out through the dock's padding, so the band meets both edges.
              ? { height: 1, backgroundColor: theme.surface3, marginLeft: -1, marginRight: -1, paddingX: 1 }
              : { position: 'absolute' as const, bottom: -1, left: 1, width: composerDockTextareaWidth, height: 1 })}
            flexDirection="row"
            alignItems="center"
          >
            <box width={composerDockFooterStatsWidth} overflow="hidden" backgroundColor={fullscreenMode ? undefined : theme.surface} onMouseDown={event => { if (!voiceStatus && !composerSlashHint) clickComposerStatus(event, dockFooterStatsFor(composerDraftState.read().length), composerDockFooterStatsWidth) }} onMouseMove={event => { if (!voiceStatus && !composerSlashHint) hoverComposerStatus('dock', event, dockFooterStatsFor(composerDraftState.read().length), composerDockFooterStatsWidth) }} onMouseOut={() => setComposerStatusHover(null)}>
              <text fg={composerSlashHint ? composerAccentColor : theme.dim} wrapMode="none" selectable={false}>
                {voiceStatus ? fitText(voiceStatus, composerDockFooterStatsWidth) : composerSlashHint
                  ? fitText(composerSlashHint, composerDockFooterStatsWidth)
                  : <DraftLengthSpans draft={composerDraftState} build={dockFooterStatsFor} width={composerDockFooterStatsWidth} padFg={theme.dim} hover={composerStatusHover?.site === 'dock' ? { index: composerStatusHover.index, bg: theme.surface3 } : null} />}
              </text>
            </box>
            {dockShowsStatusBar ? <TeammatesAttention inline theme={theme} width={Math.floor(composerDockTextareaWidth / 3)} session={selectedSession} /> : null}
            <box flexGrow={1} />
            <box width={composerDockFooterHintWidth} minWidth={0} flexShrink={1} overflow="hidden" backgroundColor={fullscreenMode ? undefined : theme.surface}>
              <text fg={composerActive && !visibleComposerSending ? composerAccentColor : theme.dim} wrapMode="none">
                {dockShowsStatusBar
                  ? renderInlineTextSegments(footerSegments, composerDockFooterHintWidth, theme.dim)
                  : composerDockSendingHintSegments
                  ? renderInlineTextSegments(composerDockSendingHintSegments, composerDockFooterHintWidth, theme.dim)
                  : fitHintText(composerDockFooterHint, composerDockFooterHintWidth)}
              </text>
            </box>
          </box>
        </SectionFrame>
      ) : null
  )
}
