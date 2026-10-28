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
import { type RefObject, type ReactNode } from 'react'
import { type QuietWorkspaceState } from '../../workspaceContext'
import { type TextareaRenderable } from '@opentui/core'
import { DraftLengthSpans } from '../inlineText'
import { type TuiTranscriptCard } from '../../../format'
import { type WindowChrome } from '../../windowChrome'
import { Spinner, ComposerWaitingStatus, IdleTicker } from '../chrome'
import { type SurfacePanelState, activeSurface, closeSurface as closeSurfaceIn, cycleSurface as cycleSurfaceIn, openSurface as openSurfaceIn, type TuiSurface } from '../../surfacePanelState'
import { panelSurfaceAvailability } from '../../../../lib/rightPanel'
import { isPluginSurfaceId } from '../../../../lib/plugins/catalog'
import { SurfacePanel } from '../../SurfacePanel'
import { type WindowSurfaceKind } from '../../windowSurfaceNames'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

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

export type EmbeddedComposerChromeContext = {
  composerWindowOpen: boolean
  composerHidden: boolean
  presentationHidesComposer: boolean
  embeddedComposer: boolean
  composerDockHeight: number
  theme: TuiThemePalette
  chatComposerFocused: boolean
  composerActive: boolean
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  renderComposerTextarea: (onSubmit: () => void, options?: { height?: number; width?: number; variant?: 'chat'; background?: string; }) => React.ReactNode
  submitComposerFromDock: () => void
  composerDockTextareaHeight: number
  chatComposerStatusWidth: number
  chatComposerStatsWidth: number
  composerSlashHint: string
  clickComposerStatus: (event: { button: number; x: number; currentTarget: { x: number; } | null; stopPropagation: () => void; }, segments: InlineTextSegment[], width: number) => void
  composerDockStatsFor: (draftLength: number) => InlineTextSegment[]
  composerDraftState: QuietWorkspaceState
  hoverComposerStatus: (site: 'chat' | 'dock', event: { x: number; currentTarget: { x: number; } | null; }, segments: InlineTextSegment[], width: number) => void
  setComposerStatusHover: React.Dispatch<React.SetStateAction<{ site: 'chat' | 'dock'; index: number; } | null>>
  composerAccentColor: string
  composerStatusHover: { site: 'chat' | 'dock'; index: number; } | null
  chatComposerHintWidth: number
  visibleComposerSending: boolean
  composerDockSendingHintSegments: InlineTextSegment[] | null
  chatComposerHintFitted: string
}

export function runEmbeddedComposerChrome(ctx: EmbeddedComposerChromeContext) {
  const {
    composerWindowOpen, composerHidden, presentationHidesComposer, embeddedComposer,
    composerDockHeight, theme, chatComposerFocused, composerActive, setComposerActive,
    composerTextareaRef, renderComposerTextarea, submitComposerFromDock,
    composerDockTextareaHeight, chatComposerStatusWidth, chatComposerStatsWidth, composerSlashHint,
    clickComposerStatus, composerDockStatsFor, composerDraftState, hoverComposerStatus,
    setComposerStatusHover, composerAccentColor, composerStatusHover, chatComposerHintWidth,
    visibleComposerSending, composerDockSendingHintSegments, chatComposerHintFitted,
  } = ctx
return !composerWindowOpen && !composerHidden && !presentationHidesComposer && embeddedComposer ? {
  rows: composerDockHeight,
  render: (chromeWidth: number) => (
      // Chat and Agents: the composer is the reader box's own trailing child —
      // a full-width highlighted bar in the same style as a user message
      // row, inside the same border as the transcript, so it reads as
      // the next line of the conversation rather than a docked control.
      <box
        id="composer-dock"
        width="100%"
        height={composerDockHeight}
        flexDirection="column"
        paddingX={1}
        backgroundColor={theme.surface2}
        border={['top', 'left', 'right']}
        borderStyle="single"
        borderColor={chatComposerFocused ? theme.border2 : theme.surface2}
      >
        <box
          flexGrow={1}
          overflow="hidden"
          paddingX={1}
          paddingBottom={1}
          // Matches the textarea so the well covers the prompt glyph and
          // the padding either side of it, not just the text.
          backgroundColor={chatComposerFocused ? theme.bg : theme.surface2}
          flexDirection="row"
          onMouseDown={(event) => {
            if (event.button !== 0) return
            if (!composerActive) setComposerActive(true)
            composerTextareaRef.current?.focus()
          }}
        >
          <text fg={chatComposerFocused ? theme.text : theme.dim} wrapMode="none">
            {chatComposerFocused ? '❯ ' : '› '}
          </text>
          <box flexGrow={1}>
            {renderComposerTextarea(submitComposerFromDock, {
              height: composerDockTextareaHeight,
              width: Math.max(chromeWidth - 8, 1),
              variant: 'chat',
            })}
          </box>
        </box>
        <box
          id="chat-composer-status"
          position="absolute"
          bottom={-1}
          left={1}
          width={chatComposerStatusWidth}
          height={1}
          overflow="hidden"
          flexDirection="row"
          alignItems="center"
        >
          <box width={chatComposerStatsWidth} overflow="hidden" backgroundColor={theme.surface2} onMouseDown={event => { if (!composerSlashHint) clickComposerStatus(event, composerDockStatsFor(composerDraftState.read().length), chatComposerStatsWidth) }} onMouseMove={event => { if (!composerSlashHint) hoverComposerStatus('chat', event, composerDockStatsFor(composerDraftState.read().length), chatComposerStatsWidth) }} onMouseOut={() => setComposerStatusHover(null)}>
            <text id="chat-composer-focus-state" fg={composerSlashHint ? composerAccentColor : theme.dim} wrapMode="none" selectable={false}>
              {composerSlashHint
                ? fitText(composerSlashHint, chatComposerStatsWidth)
                : <DraftLengthSpans draft={composerDraftState} build={composerDockStatsFor} width={chatComposerStatsWidth} padFg={theme.dim} hover={composerStatusHover?.site === 'chat' ? { index: composerStatusHover.index, bg: theme.surface3 } : null} />}
            </text>
          </box>
          <box flexGrow={1} />
          <box width={chatComposerHintWidth} overflow="hidden" backgroundColor={theme.surface2}>
            <text fg={chatComposerFocused && !visibleComposerSending ? composerAccentColor : theme.dim} wrapMode="none">
              {chatComposerFocused && composerDockSendingHintSegments
                ? renderInlineTextSegments(composerDockSendingHintSegments, chatComposerHintWidth, theme.dim)
                : chatComposerHintFitted}
            </text>
          </box>
        </box>
      </box>
  ),
} : null
}

export type ReaderFooterChromeContext = {
  chatTurnStatusRows: 1 | 0
  idleTickerShown: boolean
  embeddedComposerChrome: WindowChrome | null
  densityState: { cardGap: number; bodyIndent: number; bodyLines: number; headerRows: number; bodyPad: number; streamGap: number; streamUserGap: number; }
  theme: TuiThemePalette
  visibleComposerSending: boolean
  composerSendStartedAt: number | null
  composerWaitingStatusSeed: string
  composerWaitingSuffix: string | null
  composerWaitingOnUser: 'Waiting for your answer' | 'Waiting for your approval' | null
  visibleAwaitingPersistedTurn: boolean
  followTail: boolean
  visibleTranscriptCards: TuiTranscriptCard[]
  turnRunningForComposer: boolean
  embeddedComposer: boolean
  isStreamView: boolean
  selectedSessionKey: string | null
}

export function runReaderFooterChrome(ctx: ReaderFooterChromeContext) {
  const {
    chatTurnStatusRows, idleTickerShown, embeddedComposerChrome, densityState, theme,
    visibleComposerSending, composerSendStartedAt, composerWaitingStatusSeed,
    composerWaitingSuffix, composerWaitingOnUser, visibleAwaitingPersistedTurn, followTail,
    visibleTranscriptCards, turnRunningForComposer, embeddedComposer, isStreamView,
    selectedSessionKey,
  } = ctx
return {
  rows: chatTurnStatusRows + (idleTickerShown ? 2 : 0) + (embeddedComposerChrome?.rows ?? 0),
  render: (chromeWidth: number) => (
    <>
    {chatTurnStatusRows > 0 ? (
      <box
        id="chat-turn-status"
        height={1}
        flexShrink={0}
        paddingLeft={densityState.bodyIndent + 1}
        flexDirection="row"
      >
        <text fg={theme.cyan} wrapMode="none">{'● '}</text>
        <box flexGrow={1}>
          {visibleComposerSending ? (
            <ComposerWaitingStatus
              startedAt={composerSendStartedAt}
              seed={composerWaitingStatusSeed}
              suffix={composerWaitingSuffix}
              theme={theme}
              width={Math.max(chromeWidth - densityState.bodyIndent - 6, 16)}
              message={composerWaitingOnUser}
            />
          ) : (
            <Spinner
              label={fitText(
                visibleAwaitingPersistedTurn
                  ? 'Syncing transcript…'
                  : 'Turn running · reattached — output syncs as it persists · ⌃C interrupt',
                Math.max(chromeWidth - densityState.bodyIndent - 6, 16),
              )}
              fg={theme.cyan}
              labelFg={theme.dim}
            />
          )}
        </box>
      </box>
    ) : null}

    {/* The idle ticker means "nothing is happening — still watching". A
        running turn has its own pinned status row next to the composer
        (elapsed, tokens, interrupt hint), so showing both put a spinner
        reading "waiting patiently" directly above one reading "Shaping
        the next move… 2s". Exactly one spinner is on screen at a time,
        and which one tells you whether a turn is live.

        Chat and Agents omit the idle ticker. Their single activity row
        appears immediately above the composer only while a turn runs.
        Stream and Scrollback omit it too: they are the bare transcript,
        and two rows saying nothing is happening are two rows of it. */}
    {followTail && visibleTranscriptCards.length > 0
      && !turnRunningForComposer && !embeddedComposer && !isStreamView ? (
      <box paddingX={2} paddingBottom={1}>
        <IdleTicker seed={selectedSessionKey ?? ''} theme={theme} />
      </box>
    ) : null}

    {embeddedComposerChrome?.render(chromeWidth)}
    </>
  ),
}
}

export type SurfacePanelElementContext = {
  surfacePanelVisible: boolean
  surfacePanel: SurfacePanelState
  theme: TuiThemePalette
  surfacePanelAtBottom: boolean
  readerAreaWidth: number
  effectiveSurfacePanelWidth: number
  surfacePanelExpanded: boolean
  surfacePanelPlacement: 'right' | 'bottom'
  effectiveSurfacePanelRows: number
  surfacePanelHeight: number
  surfacePanelFocused: boolean
  gitRepoCwd: string
  liveSubagentText: Record<string, string>
  setSurfacePanel: React.Dispatch<React.SetStateAction<SurfacePanelState>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  toggleSurfacePanelPlacement: () => void
  openSurfaceWindow: (kind: WindowSurfaceKind, options?: { another?: boolean; fromPanelId?: string; }) => void
  setSurfacePanelExpanded: React.Dispatch<React.SetStateAction<boolean>>
  setSurfacePanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  surfacePanelResizeFromRef: React.RefObject<number | null>
  setSurfacePanelResizing: React.Dispatch<React.SetStateAction<boolean>>
  surfacePanelKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  surfacePluginKeyRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean | void) | null>
  renderSurfaceBody: (kind: WindowSurfaceKind, box: { width: number; height: number; }, close: () => void, focused: boolean, slot?: WindowSurfaceId, panelId?: string, panelCwd?: string) => React.ReactNode
}

export function runSurfacePanelElement(ctx: SurfacePanelElementContext) {
  const {
    surfacePanelVisible, surfacePanel, theme, surfacePanelAtBottom, readerAreaWidth,
    effectiveSurfacePanelWidth, surfacePanelExpanded, surfacePanelPlacement,
    effectiveSurfacePanelRows, surfacePanelHeight, surfacePanelFocused, gitRepoCwd,
    liveSubagentText, setSurfacePanel, setSurfacePanelFocused, toggleSurfacePanelPlacement,
    openSurfaceWindow, setSurfacePanelExpanded, setSurfacePanelOpen, surfacePanelResizeFromRef,
    setSurfacePanelResizing, surfacePanelKeyHandlerRef, surfacePluginKeyRef, renderSurfaceBody,
  } = ctx
return surfacePanelVisible ? (
  <SurfacePanel
    state={surfacePanel}
    theme={theme}
    width={surfacePanelAtBottom ? readerAreaWidth : effectiveSurfacePanelWidth}
    expanded={surfacePanelExpanded}
    placement={surfacePanelPlacement}
    height={surfacePanelAtBottom ? effectiveSurfacePanelRows : surfacePanelHeight}
    focused={surfacePanelFocused}
    availability={panelSurfaceAvailability('tui', {
      browser: true,
      terminal: true,
      files: !!gitRepoCwd,
      diff: !!gitRepoCwd,
      'pull-request': !!gitRepoCwd,
      agents: true,
    })}
    unavailableHints={{
      files: 'Available when a project is open.',
      diff: 'Available for Git repositories.',
      'pull-request': 'Available when a project is open.',
    }}
    liveAgentCount={Object.values(liveSubagentText).filter((text) => text.trim().length > 0).length}
    onOpenSurface={(kind) => setSurfacePanel((current) => openSurfaceIn(current, kind))}
    onCloseSurface={(id) => setSurfacePanel((current) => closeSurfaceIn(current, id))}
    onCycleSurface={(delta) => setSurfacePanel((current) => cycleSurfaceIn(current, delta))}
    onBlur={() => setSurfacePanelFocused(false)}
    onFocus={() => setSurfacePanelFocused(true)}
    onActivateSurface={(id) => setSurfacePanel((current) => ({ ...current, activeId: id }))}
    onTogglePlacement={() => toggleSurfacePanelPlacement()}
    onMoveToWindow={(kind) => openSurfaceWindow(kind, { fromPanelId: activeSurface(surfacePanel)?.id })}
    onToggleExpand={() => setSurfacePanelExpanded((current) => !current)}
    onClosePanel={() => {
      setSurfacePanelOpen(false)
      setSurfacePanelFocused(false)
    }}
    onResizeStart={(position) => {
      surfacePanelResizeFromRef.current = position
      setSurfacePanelResizing(true)
    }}
    onKeyHandlerReady={(handler) => { surfacePanelKeyHandlerRef.current = handler }}
    surfaceKeyHandler={(key) => {
      const surface = activeSurface(surfacePanel)
      if (!surface) return
      if (isPluginSurfaceId(surface.kind)) surfacePluginKeyRef.current?.(key)
      // agents is read-only.
    }}
    renderSurface={(surface: TuiSurface, box) => renderSurfaceBody(surface.kind, box, () => setSurfacePanel((current) => closeSurfaceIn(current, surface.id)), surfacePanelFocused, undefined, surface.id, surface.cwd)}
  />
) : null
}
