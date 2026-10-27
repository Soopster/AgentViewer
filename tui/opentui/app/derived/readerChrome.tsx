/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { TextAttributes } from '@opentui/core'
import { type TuiTranscriptView } from '../../../theme'
import { writeTuiShowToolCalls } from '../../../../lib/tui/service'
import { type ContextUsage, type Session } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { type InlineTextSegment, renderInlineTextSegments } from '../inlineText'
import { contextBarSegments } from '../contextMeter'
import { TRANSCRIPT_VIEW_LABELS } from '../commands'

export type ReaderHeaderChromeContext = {
  presentationFocusMode: boolean
  isCopilotView: boolean
  isStreamView: boolean
  contextRowShown: boolean
  fleetStripVisible: boolean
  error: string | null
  showToolCalls: boolean
  tailBannerShown: boolean
  normalizedSearchQuery: string
  theme: TuiThemePalette
  providerAccent: string
  showTabs: boolean
  transcriptView: TuiTranscriptView
  followTail: boolean
  readerTitle: string
  readerContextMeta: string
  contextUsage: ContextUsage | null
  selectedSession: Session | null
  contextUsageStatus: 'idle' | 'loading' | 'unavailable' | 'ready'
  fleetStripSegments: InlineTextSegment[]
  setShowToolCalls: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  isScrollbackView: boolean
  pendingNewCount: number
  searchQuery: string
  searchMatches: number[]
  searchMatchIndex: number
}

export function runReaderHeaderChrome(ctx: ReaderHeaderChromeContext) {
  const {
    presentationFocusMode, isCopilotView, isStreamView, contextRowShown, fleetStripVisible, error,
    showToolCalls, tailBannerShown, normalizedSearchQuery, theme, providerAccent, showTabs,
    transcriptView, followTail, readerTitle, readerContextMeta, contextUsage, selectedSession,
    contextUsageStatus, fleetStripSegments, setShowToolCalls, setError, isScrollbackView,
    pendingNewCount, searchQuery, searchMatches, searchMatchIndex,
  } = ctx
return {
  rows: (!presentationFocusMode && isCopilotView ? 1 : 0) + (!presentationFocusMode && !isStreamView ? 2 : 0)
    + (contextRowShown ? 1 : 0) + (fleetStripVisible ? 1 : 0) + (error ? 2 : 0) + (!showToolCalls ? 1 : 0)
    + (tailBannerShown ? 2 : 0) + (normalizedSearchQuery ? 2 : 0),
  render: (chromeWidth: number) => (
    <>
    {!presentationFocusMode && isCopilotView ? (
      <box height={1} paddingX={1} flexDirection="row" alignItems="center">
        {['Current', 'Sessions', 'Issues', 'Pull requests', 'Gists'].map((tab) => {
          const active = tab === 'Current'
          return (
            <box key={tab} paddingX={1} backgroundColor={active ? theme.cyan : theme.bg}>
              <text fg={active ? theme.bg : theme.muted} attributes={active ? TextAttributes.BOLD : undefined} wrapMode="none">{tab}</text>
            </box>
          )
        })}
      </box>
    ) : null}

    {!presentationFocusMode && !isStreamView ? (
      <box paddingX={2} paddingTop={1} flexDirection="row" alignItems="center">
        <text fg={providerAccent} wrapMode="none">{'● '}</text>
        <box flexGrow={1} overflow="hidden">
          <text fg={theme.muted} wrapMode="none">
            {fitText(showTabs
              ? `${TRANSCRIPT_VIEW_LABELS[transcriptView]} · ${followTail ? 'Following latest' : 'Reading history'}`
              : `${TRANSCRIPT_VIEW_LABELS[transcriptView]} · ${readerTitle}`, Math.max(chromeWidth - readerContextMeta.length - 10, 12))}
          </text>
        </box>
        <box width={readerContextMeta.length} overflow="hidden">
          <text fg={theme.dim} wrapMode="none">{readerContextMeta}</text>
        </box>
      </box>
    ) : null}

    {!presentationFocusMode && !isStreamView && contextUsage ? (
      <box paddingX={1}>
        <text wrapMode="none">
          {renderInlineTextSegments(
            contextBarSegments(contextUsage.totalTokens, contextUsage.maxTokens, contextUsage.percentage, theme),
            chromeWidth - 4,
            theme.dim,
          )}
        </text>
      </box>
    ) : !presentationFocusMode && !isStreamView && selectedSession?.provider === 'claude' && contextUsageStatus === 'loading' ? (
      <box paddingX={1}>
        <text fg={theme.dim}>{fitText('Loading context usage…', chromeWidth - 4)}</text>
      </box>
    ) : !presentationFocusMode && !isStreamView && selectedSession?.provider === 'claude' && contextUsageStatus === 'unavailable' ? (
      <box paddingX={1}>
        <text fg={theme.dim}>{fitText('Context usage unavailable', chromeWidth - 4)}</text>
      </box>
    ) : null}

    {fleetStripVisible ? (
      <box paddingX={1} flexDirection="row" overflow="hidden">
        <text wrapMode="none">
          {renderInlineTextSegments(fleetStripSegments, chromeWidth - 4, theme.dim)}
        </text>
      </box>
    ) : null}

    {error ? (
      <box paddingX={1} marginTop={1}>
        <text fg={theme.red}>{fitText(error, chromeWidth - 4)}</text>
      </box>
    ) : null}

    {!showToolCalls ? (
      <box
        id="show-tool-activity"
        height={1}
        paddingX={1}
        onMouseDown={(event) => {
          if (event.button !== 0) return
          event.stopPropagation()
          setShowToolCalls(true)
          void writeTuiShowToolCalls(true).catch((err) => setError(err instanceof Error ? err.message : 'Failed to store tool visibility'))
        }}
      >
        <text fg={theme.amber} wrapMode="none">{fitText('TOOLS HIDDEN · Click or Shift+X to show file and tool activity', chromeWidth - 4)}</text>
      </box>
    ) : null}

    {/* Reserved while reading history elsewhere; SCROLLBACK leaves the tail
        on every scroll, and two rows appearing above the text would jolt
        it, so there the banner exists only while it has something to say. */}
    {!followTail && (!isScrollbackView || pendingNewCount > 0) ? (
      <box paddingX={1} marginTop={1}>
        <text fg={theme.amber}>
          {pendingNewCount > 0
            ? fitText(`+${pendingNewCount} new messages waiting. Press u for first unread or f for live tail.`, chromeWidth - 4)
            : ' '}
        </text>
      </box>
    ) : null}

    {normalizedSearchQuery ? (
      <box paddingX={1} marginTop={1}>
        <text fg={theme.dim}>
          {fitText(
            `/${searchQuery}  ${searchMatches.length === 0 ? 'no matches' : `${searchMatchIndex + 1}/${searchMatches.length} matches`}`,
            chromeWidth - 4,
          )}
        </text>
      </box>
    ) : null}

    </>
  ),
}
}
