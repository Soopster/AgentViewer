/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { SyntaxStyle } from '@opentui/core'
import type { TuiThemePalette } from '../../../theme'
import type { OpenCodeTodo } from '../../../../lib/taskRegistry'
import type { CliRenderer } from '@opentui/core'
import React from 'react'
import { PluginSurfaceHost } from '../../shell/PluginSurfaceHost'
import { type TuiPluginCapture, type TuiProvidedPluginServices } from '../../shell/pluginTypes'
import { getPluginSurface, isPluginPanelSurfaceId, isPluginSurfaceId, type PluginSurfaceId } from '../../../../lib/plugins/catalog'
import { HandoffBriefPopover } from '../../HandoffBriefPopover'
import { TaskSidePanel } from '../../TaskSidePanel'
import { type WindowSurfaceKind } from '../../windowSurfaceNames'
import { type SurfaceMeta } from '../../popoverWindows'
import { type TuiTranscriptCard } from '../../../format'
import { type ThreadedMessage } from '../../../../lib/threading'
import { type TuiDensity } from '../../../theme'
import { readTuiPrompts, readTuiPrompt, saveTuiPrompt, deleteTuiPrompt, type TuiSessionDetail } from '../../../../lib/tui/service'
import { type PlaybookSummary } from '../../../../lib/agentProtocol'
import { type Session } from '../../../../lib/types'
import { AttentionInboxPopover, type AttentionItem } from '../../AttentionInboxPopover'
import { type PermissionResponse } from '../../../../lib/permissions'
import { type NoticeTone } from '../types'
import { writeClipboard } from '../clipboard'
import { sessionKey } from '../sessionList'
import { type WindowSurfaceId, PinnedSessionDetail } from '../SplitTranscriptPane'
import { pluginSurfaceWants } from '../pluginCommands'
import { PromptLibraryPopover, DailySummaryPopover, PlaybookManagerPopover } from '../lazyOverlays'
import { type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { type TuiTranscriptView } from '../../../theme'
import { type MouseEvent } from '@opentui/core'
import { type TuiDiffLayout, type TuiTranscriptWidth } from '../../../../lib/tui/service'
import { type ProtocolRunSnapshot } from '../../../../lib/agentProtocol'
import { RetainedWindow } from '../../windowActivity'
import { type SendState } from '../../../../lib/types'
import { type MenuPoint, type PaneFocus } from '../types'
import { FLOATING_PANE_INDEX } from '../layoutConstants'
import { isLiveAssistantTextMessage } from '../liveStream'
import { SPLIT_PANE_EMPTY_LIVE, type SplitPaneHandle, type TranscriptDiffControls, SplitTranscriptPane } from '../SplitTranscriptPane'
import { WindowButton } from '../../WindowButton'
import { surfaceKindOf } from '../../windowSurfaceNames'
import { isPopoverWindowKind } from '../../popoverWindows'
import { surfaceWindowKey } from '../../windowOrder'
import { isDoubleClick } from '../SplitTranscriptPane'
import { type WindowLayout, windowLayoutRects } from '../../windowLayout'
import { type SplitRect, type SplitDivider } from '../../windowSplitTree'
import { clampFloatingRect, type FloatingRect, type WindowStack } from '../../windowTabs'
import { isSurfaceWindowKey, surfaceIdOfKey } from '../../windowOrder'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { fitText } from '../../textLayout'

export type RenderSurfaceBodyInnerContext = {
  windowSurfaceMeta: Record<string, SurfaceMeta>
  gitRepoCwd: string
  popoverTabs: string[]
  focusReaderFromSplit: () => void
  windowSurfaceKeysRef: React.RefObject<Map<string, (key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => unknown>>
  windowSurfaceCaptureRef: React.RefObject<Map<string, boolean | 'none' | 'input' | 'terminal'>>
  pluginSessionFor: (surfaceId: PluginSurfaceId, slot?: WindowSurfaceId) => Session | null
  pluginSelectedDetail: { key: string | null; detail: TuiSessionDetail | null; }
  pluginLiveTranscript: { key: string | null; messages: ThreadedMessage[]; }
  pluginOpenRequests: Partial<Record<'terminal' | 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk', { count: number; session: Session | null; }>>
  density: TuiDensity
  showToolCalls: boolean
  splitPaneShouldYield: () => boolean
  gitSessionId: string | null
  windowPluginServices: (slot: WindowSurfaceId) => TuiProvidedPluginServices
  fileHistoryServices: TuiProvidedPluginServices
  pluginServicesFor: (surfaceId: PluginSurfaceId) => TuiProvidedPluginServices
  handoffBriefSyntaxStyle: SyntaxStyle
  fileHistoryPath: string | null
  editorInitialPath: string | null
  editorInitialLine: number | null
  theme: TuiThemePalette
  composerAccentColor: string
  surfacePluginKeyRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean | void) | null>
  surfacePluginCaptureChange: (capture: TuiPluginCapture) => void
  runCommandForPlugin: (id: string) => boolean
  taskPanelMessages: ThreadedMessage[]
  composerLiveTodos: OpenCodeTodo[]
  selectedSession: Session | null
  visibleTranscriptCards: TuiTranscriptCard[]
  jumpToTranscriptIndex: (index: number) => void
  liveSubagentText: Record<string, string>
  attentionItems: AttentionItem[]
  attentionRespondingId: string | null
  respondToAttentionItem: (item: AttentionItem, response: PermissionResponse) => Promise<void>
  openAttentionSession: (item: AttentionItem) => void
  dismissAttentionItem: (item: AttentionItem) => void
  selectedSessionTarget: Session | null
  insertComposerPromptText: (text: string) => void
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  sessionDetail: TuiSessionDetail | null
  handleCoordPlaybooksChanged: (playbooks: PlaybookSummary[], preferredName?: string) => void
  pinnedSessionOf: (surface: WindowSurfaceId) => Session | null
  bookmarkKeys: Set<string>
  renderer: CliRenderer
  appendDiffCommentPromptToComposer: (prompt: string, trailing?: string) => void
}

export function runRenderSurfaceBodyInner(ctx: RenderSurfaceBodyInnerContext, kind: WindowSurfaceKind, box: { width: number; height: number }, close: () => void, focused: boolean, slot?: WindowSurfaceId, panelCwd?: string) {
  const {
    windowSurfaceMeta, gitRepoCwd, popoverTabs, focusReaderFromSplit, windowSurfaceKeysRef,
    windowSurfaceCaptureRef, pluginSessionFor, pluginSelectedDetail, pluginLiveTranscript,
    pluginOpenRequests, density, showToolCalls, splitPaneShouldYield, gitSessionId,
    windowPluginServices, fileHistoryServices, pluginServicesFor, handoffBriefSyntaxStyle,
    fileHistoryPath, editorInitialPath, editorInitialLine, theme, composerAccentColor,
    surfacePluginKeyRef, surfacePluginCaptureChange, runCommandForPlugin, taskPanelMessages,
    composerLiveTodos, selectedSession, visibleTranscriptCards, jumpToTranscriptIndex,
    liveSubagentText, attentionItems, attentionRespondingId, respondToAttentionItem,
    openAttentionSession, dismissAttentionItem, selectedSessionTarget, insertComposerPromptText,
    showNotice, sessionDetail, handleCoordPlaybooksChanged, pinnedSessionOf, bookmarkKeys,
    renderer, appendDiffCommentPromptToComposer,
  } = ctx
  const surfaceCwd = slot ? windowSurfaceMeta[slot]?.cwd ?? gitRepoCwd : panelCwd ?? gitRepoCwd
  // A popover's own close (q, Esc) leaves a window but closes a popover tab.
  const leave = slot && popoverTabs.includes(slot) ? close : focusReaderFromSplit
  type SurfaceKeyHandler = (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => unknown
  // A popover's handler takes its own key type, a subset of what the root sends.
  const keysReady = (panelRef: { current: SurfaceKeyHandler | null }) => <K,>(handler: (key: K) => unknown) => {
    const surfaceHandler = handler as unknown as SurfaceKeyHandler
    if (slot) windowSurfaceKeysRef.current.set(slot, surfaceHandler)
    else panelRef.current = surfaceHandler
  }
  const captureChange = <T extends 'none' | 'input' | 'terminal' | boolean>(panelRef: { current: T }) => (capture: T) => {
    if (slot) windowSurfaceCaptureRef.current.set(slot, capture)
    else panelRef.current = capture
  }
  // Plugin surfaces in windows and the side panel. A popover kind's close
  // (Esc, q) leaves its window; a side-panel kind's closes it, as Files' does.
  if (isPluginSurfaceId(kind)) {
    const pinned = pluginSessionFor(kind, slot)
    // A file-pinned window shows its own file; the editor opens where it was asked to.
    const pathPinned = getPluginSurface(kind).pin === 'path'
    return (
      <PluginSurfaceHost
        surfaceId={kind}
        placement={slot ? 'window' : 'panel'}
        session={pinned}
        sessionKey={pinned ? sessionKey(pinned) : null}
        selected={pluginSelectedDetail}
        live={pluginLiveTranscript}
        request={pluginOpenRequests[kind]?.count}
        density={density}
        showToolCalls={showToolCalls}
        shouldYield={splitPaneShouldYield}
        cwd={surfaceCwd}
        repositorySessionId={gitSessionId}
        provided={slot && !pluginSurfaceWants(kind, 'session-fleet') ? windowPluginServices(slot) : kind === 'file-history' ? fileHistoryServices : pluginServicesFor(kind)}
        syntaxStyle={handoffBriefSyntaxStyle}
        path={pathPinned ? (slot ? windowSurfaceMeta[slot]?.path : fileHistoryPath) ?? null : editorInitialPath}
        line={pathPinned ? null : editorInitialLine}
        theme={theme}
        accent={composerAccentColor}
        width={box.width}
        height={box.height}
        focused={focused}
        onClose={isPluginPanelSurfaceId(kind) ? close : leave}
        onKeyHandlerReady={keysReady(surfacePluginKeyRef as { current: SurfaceKeyHandler | null })}
        onCaptureChange={slot ? captureChange<TuiPluginCapture>({ current: false }) : surfacePluginCaptureChange}
        runCommand={runCommandForPlugin}
      />
    )
  }
  switch (kind) {
    case 'agents':
      return (
        <TaskSidePanel
          messages={taskPanelMessages}
          todos={composerLiveTodos}
          session={selectedSession}
          theme={theme}
          width={box.width}
          height={box.height}
          onSelectTask={(uuid) => {
            const idx = visibleTranscriptCards.findIndex((c) => c.key === uuid)
            if (idx >= 0) jumpToTranscriptIndex(idx)
          }}
          tab="agents"
          liveSubagentText={liveSubagentText}
        />
      )
    // Popovers in windows: `close` there leaves the window (Esc, q), so the
    // popover's own close keys hand focus back rather than closing it.
    case 'attention':
      return (
        <AttentionInboxPopover docked items={attentionItems} theme={theme} width={box.width} height={box.height}
          respondingId={attentionRespondingId}
          onRespond={(item, response) => { void respondToAttentionItem(item, response) }}
          onOpenSession={openAttentionSession} onDismiss={dismissAttentionItem}
          onClose={leave} onKeyHandlerReady={keysReady({ current: null })} />
      )
    case 'prompt-library':
      return (
        <PromptLibraryPopover docked theme={theme} accentColor={composerAccentColor} width={box.width} height={box.height}
          activeProvider={selectedSessionTarget?.provider}
          loadPrompts={readTuiPrompts} loadPrompt={readTuiPrompt} savePrompt={saveTuiPrompt} deletePrompt={deleteTuiPrompt}
          onInsert={insertComposerPromptText} onClose={leave} onNotice={showNotice}
          onKeyHandlerReady={keysReady({ current: null })} />
      )
    case 'playbooks':
      return (
        <PlaybookManagerPopover docked theme={theme} width={box.width} height={box.height}
          cwd={selectedSession?.cwd ?? sessionDetail?.info?.cwd ?? process.cwd()}
          onClose={leave} onChanged={handleCoordPlaybooksChanged} onNotice={showNotice}
          onKeyHandlerReady={keysReady({ current: null })} />
      )
    case 'handoff':
      return (
        <PinnedSessionDetail session={slot ? pinnedSessionOf(slot) : selectedSession} density={density} showToolCalls={showToolCalls} shouldYield={splitPaneShouldYield} theme={theme}>
          {(detail, session) => (
            <HandoffBriefPopover docked session={session} detail={detail} bookmarkIds={bookmarkKeys}
              theme={theme} syntaxStyle={handoffBriefSyntaxStyle} width={box.width} height={box.height}
              onClose={leave}
              onCopy={async (text) => {
                try {
                  await writeClipboard(text, renderer)
                  showNotice('info', 'Copied handoff brief to clipboard')
                } catch (err) {
                  showNotice('error', err instanceof Error ? err.message : 'Failed to copy handoff brief')
                }
              }}
              onKeyHandlerReady={keysReady({ current: null })} />
          )}
        </PinnedSessionDetail>
      )
    case 'daily-summary':
      return (
        <DailySummaryPopover
          docked
          theme={theme}
          accentColor={composerAccentColor}
          width={box.width}
          height={box.height}
          waiting={attentionItems.map((item) => ({ provider: item.provider, sessionId: item.sessionId, kind: item.kind, text: item.title }))}
          onClose={leave}
          onNotice={showNotice}
          onKeyHandlerReady={keysReady({ current: null })}
          onCopy={(text) => { void writeClipboard(text, renderer) }}
          onSendToComposer={(text) => appendDiffCommentPromptToComposer(text)}
        />
      )
  }
}

export type RenderSplitPaneContext = {
  selectedSessionKey: string | null
  chromeWindowIndex: number
  visibleSplitPaneCount: number
  windowNumberOffset: 1 | 2
  primaryLeaf: boolean
  floatingKey: string | null
  effectiveFocus: PaneFocus
  splitFocusIndex: number | null
  composerActive: boolean
  reportSelectedWindowCursor: (cardKey: string | null) => void
  setFollowTail: React.Dispatch<React.SetStateAction<boolean>>
  fullscreenMode: boolean
  deferredSearchQuery: string
  searchMatches: number[]
  visibleTranscriptCards: TuiTranscriptCard[]
  searchMatchIndex: number
  registerSplitPaneHandle: (paneIndex: number, handle: SplitPaneHandle | null, expected?: SplitPaneHandle) => void
  theme: TuiThemePalette
  densityState: { cardGap: number; bodyIndent: number; bodyLines: number; headerRows: number; bodyPad: number; streamGap: number; streamUserGap: number; }
  density: TuiDensity
  showToolCalls: boolean
  syntaxStyle: SyntaxStyle | null
  shouldEnableSyntaxHighlighting: boolean
  transcriptDiffControls: TranscriptDiffControls
  agentToolCursorByGroupKey: Record<string, string>
  selectAgentTool: (groupKey: string, toolKey: string) => void
  thinkingMode: boolean
  diffLayout: TuiDiffLayout
  imessageStyle: boolean
  transcriptWidth: TuiTranscriptWidth
  transcriptView: TuiTranscriptView
  splitPaneLiveMessages: Map<string, ThreadedMessage[]>
  liveTranscriptBaselineRef: React.RefObject<Map<string, { count: number; lastFingerprint: string | null; sequenceFingerprint: string; startedAt: number; }>>
  splitPaneRunningKeys: Set<string>
  badgeForWindow: (key: string, compact?: boolean) => string | null
  watchedCoordinator: ProtocolRunSnapshot | null
  reportWindowActivity: (key: string, version: string, errorVersion: string | null) => void
  composerSendState: SendState
  composerLiveText: string
  composerActivitySessionKey: string | null
  focusSplitPane: (paneIndex: number) => void
  splitPaneActions: { close: (paneIndex: number) => void; promote: (session: Session) => void; openLayout: () => void; fullscreen: () => void; sessionMenu: (session: Session, source: 'rail' | 'tab' | 'pane', point: MenuPoint, paneIndex?: number) => void; }
  stickyHeaders: boolean
  lightweightWindows: boolean
  noteTranscriptLinkPress: (event: MouseEvent) => void
  openTranscriptLinkAt: (event: MouseEvent) => boolean
  openCardAsyncQuestions: (session: Session, card: TuiTranscriptCard) => void
  floatGestureHandlers: { start: (event: { x: number; y: number; }) => void; move: (event: { x: number; y: number; }) => void; end: (event: { x: number; y: number; }) => void; }
  sessionDragHandlers: { press: (session: Session, fromPane: number | null, event: { x: number; y: number; }, onClick?: () => void) => void; move: (event: { x: number; y: number; }) => void; release: (event: { x: number; y: number; }) => void; }
  splitPaneShouldYield: () => boolean
  renderWindowTabs: (key: string, index: number, frameWidth: number, top: number, left: number, reserve: number) => React.ReactNode
}

export function runRenderSplitPane(ctx: RenderSplitPaneContext, splitSession: Session, splitIndex: number, size: { width: number; height: number; boxHeight: number | undefined }, hidden?: boolean) {
  const {
    selectedSessionKey, chromeWindowIndex, visibleSplitPaneCount, windowNumberOffset, primaryLeaf,
    floatingKey, effectiveFocus, splitFocusIndex, composerActive, reportSelectedWindowCursor,
    setFollowTail, fullscreenMode, deferredSearchQuery, searchMatches, visibleTranscriptCards,
    searchMatchIndex, registerSplitPaneHandle, theme, densityState, density, showToolCalls,
    syntaxStyle, shouldEnableSyntaxHighlighting, transcriptDiffControls, agentToolCursorByGroupKey,
    selectAgentTool, thinkingMode, diffLayout, imessageStyle, transcriptWidth, transcriptView,
    splitPaneLiveMessages, liveTranscriptBaselineRef, splitPaneRunningKeys, badgeForWindow,
    watchedCoordinator, reportWindowActivity, composerSendState, composerLiveText,
    composerActivitySessionKey, focusSplitPane, splitPaneActions, stickyHeaders,
    lightweightWindows, noteTranscriptLinkPress, openTranscriptLinkAt, openCardAsyncQuestions,
    floatGestureHandlers, sessionDragHandlers, splitPaneShouldYield, renderWindowTabs,
  } = ctx
  if (hidden === undefined) hidden = false
return (
  <box
    key={`split:${sessionKey(splitSession)}`}
    id={`split-pane:${splitIndex}`}
    visible={!hidden}
    width={size.width}
    // Stacked panes own a fixed row slice so the reader flex-grows into
    // exactly what is left; side-by-side panes fill the column height.
    height={size.boxHeight}
    flexShrink={0}
    flexDirection="column"
    overflow="hidden"
  >
    <RetainedWindow visible={!hidden} identity={`${splitIndex}:${sessionKey(splitSession) === selectedSessionKey}:${splitIndex === chromeWindowIndex}`}>
    <SplitTranscriptPane
      session={splitSession}
      paneIndex={splitIndex}
      paneNumber={splitIndex === FLOATING_PANE_INDEX ? visibleSplitPaneCount + windowNumberOffset : splitIndex + windowNumberOffset}
      paneCount={visibleSplitPaneCount + (primaryLeaf ? 1 : 0) + (floatingKey ? 1 : 0)}
      focused={effectiveFocus === 'messages' && splitFocusIndex === splitIndex && !composerActive}
      selected={sessionKey(splitSession) === selectedSessionKey}
      onCursorChange={sessionKey(splitSession) === selectedSessionKey ? reportSelectedWindowCursor : undefined}
      onFollowChange={sessionKey(splitSession) === selectedSessionKey ? setFollowTail : undefined}
      chromeHost={splitIndex === chromeWindowIndex}
      frameless={fullscreenMode}
      searchQuery={sessionKey(splitSession) === selectedSessionKey ? deferredSearchQuery : ''}
      activeSearchKey={searchMatches.length ? visibleTranscriptCards[searchMatches[searchMatchIndex] ?? -1]?.key ?? null : null}
      registerHandle={registerSplitPaneHandle}
      theme={theme}
      densityState={densityState}
      density={density}
      showToolCalls={showToolCalls}
      syntaxStyle={syntaxStyle}
      shouldEnableSyntaxHighlighting={shouldEnableSyntaxHighlighting}
      diffControls={transcriptDiffControls}
      agentToolCursorByGroupKey={agentToolCursorByGroupKey}
      onSelectAgentTool={selectAgentTool}
      thinkingMode={thinkingMode}
      diffLayout={diffLayout}
      imessageStyle={imessageStyle}
      transcriptWidth={transcriptWidth}
      transcriptView={transcriptView}
      width={size.width}
      height={size.height}
      liveMessages={splitPaneLiveMessages.get(sessionKey(splitSession)) ?? SPLIT_PANE_EMPTY_LIVE}
      liveBaselineCount={liveTranscriptBaselineRef.current.get(sessionKey(splitSession))?.count}
      running={splitPaneRunningKeys.has(sessionKey(splitSession))}
      attentionBadge={badgeForWindow(sessionKey(splitSession))}
      coordinatorLabel={watchedCoordinator?.agents.find(agent => agent.sessionId === splitSession.sessionId && (agent.provider ?? 'claude') === (splitSession.provider ?? 'claude'))?.name}
      onActivity={reportWindowActivity}
      // Streaming text belongs to whichever session the composer is
      // sending to; show it in the pane when that's this pane.
      liveText={
        composerSendState === 'sending'
        && composerLiveText
        && composerActivitySessionKey === sessionKey(splitSession)
        && !(splitPaneLiveMessages.get(sessionKey(splitSession)) ?? []).some(isLiveAssistantTextMessage)
          ? composerLiveText
          : null
      }
      onActivate={focusSplitPane}
      onClosePane={splitPaneActions.close}
      onPromotePane={splitPaneActions.promote}
      onOpenLayout={splitPaneActions.openLayout}
      onContextMenu={splitPaneActions.sessionMenu}
      stickyHeaders={stickyHeaders}
      lightweight={lightweightWindows}
      onTranscriptPress={noteTranscriptLinkPress}
      onTranscriptRelease={openTranscriptLinkAt}
      onOpenAsyncQuestions={openCardAsyncQuestions}
      floatGesture={floatGestureHandlers}
      sessionDrag={sessionDragHandlers}
      shouldYieldToForeground={splitPaneShouldYield}
    />
    </RetainedWindow>
    {renderWindowTabs(sessionKey(splitSession), splitIndex, size.width, 0, 1, 10)}
  </box>
)
}

export type RenderSurfaceWindowContext = {
  splitFocusIndex: number | null
  moveFloatGesture: (event: { x: number; y: number; }) => void
  endFloatGesture: (event?: { x: number; y: number; }) => void
  sessionDragHandlers: { press: (session: Session, fromPane: number | null, event: { x: number; y: number; }, onClick?: () => void) => void; move: (event: { x: number; y: number; }) => void; release: (event: { x: number; y: number; }) => void; }
  theme: TuiThemePalette
  windowSurfaceTitle: (surface: WindowSurfaceId) => string
  openSurfaceWindowMenu: (surface: WindowSurfaceId, _index: number, point: { x: number; y: number; }) => void
  surfacePanelFocused: boolean
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  focusSplitPane: (paneIndex: number) => void
  renderer: CliRenderer
  startFloatGesture: (mode: 'move' | 'resize', event: { x: number; y: number; }) => void
  surfaceTitleClicksRef: React.RefObject<Map<string, { current: { x: number; y: number; at: number; } | null; }>>
  toggleWindowZoom: (target?: number | null) => void
  sessionDragImplRef: React.RefObject<{ press: (_session: Session, _fromPane: number | null, _event: { x: number; y: number; }, _onClick?: () => void) => void; pressSurface: (_surface: WindowSurfaceId, _fromPane: number, _event: { x: number; y: number; }) => void; pressTab: (_key: string, _fromPane: number, _event: { x: number; y: number; }, _onClick?: () => void) => void; pressReader: (_session: Session, _event: { x: number; y: number; }) => void; move: (_event: { x: number; y: number; }) => void; release: (_event: { x: number; y: number; }) => void; }>
  renderWindowTabs: (key: string, index: number, frameWidth: number, top: number, left: number, reserve: number) => React.ReactNode
  openWindowControlMenu: (key: string, point?: { x: number; y: number; }, section?: 'resize' | 'swap' | 'session') => void
  moveSurfaceToPanel: (surface: WindowSurfaceId) => void
  closeSurfaceWindow: (surface: WindowSurfaceId, moving?: boolean) => void
  renderSurfaceBody: (kind: WindowSurfaceKind, box: { width: number; height: number; }, close: () => void, focused: boolean, slot?: WindowSurfaceId, panelId?: string, panelCwd?: string) => React.ReactNode
  composerActive: boolean
}

export function runRenderSurfaceWindow(ctx: RenderSurfaceWindowContext, surface: WindowSurfaceId, index: number, size: { width: number; height: number; boxHeight: number | undefined }, hidden?: boolean, place?: { x: number; y: number; zIndex: number }) {
  const {
    splitFocusIndex, moveFloatGesture, endFloatGesture, sessionDragHandlers, theme,
    windowSurfaceTitle, openSurfaceWindowMenu, surfacePanelFocused, setSurfacePanelFocused,
    focusSplitPane, renderer, startFloatGesture, surfaceTitleClicksRef, toggleWindowZoom,
    sessionDragImplRef, renderWindowTabs, openWindowControlMenu, moveSurfaceToPanel,
    closeSurfaceWindow, renderSurfaceBody, composerActive,
  } = ctx
  if (hidden === undefined) hidden = false
  const focused = splitFocusIndex === index
  const height = size.boxHeight ?? size.height
  return (
    <box
      key={`surface-window:${surface}`}
      id={place ? `surface-frame:${surface}` : `split-pane:${index}`}
      visible={!hidden}
      width={size.width}
      height={size.boxHeight}
      {...(place ? { position: 'absolute' as const, left: place.x, top: place.y, zIndex: place.zIndex } : {})}
      {...(index === FLOATING_PANE_INDEX ? {
        onMouseDrag: (event: { x: number; y: number }) => moveFloatGesture(event),
        onMouseUp: (event: { x: number; y: number }) => endFloatGesture(event),
      } : {
        onMouseDrag: (event: { x: number; y: number }) => sessionDragHandlers.move(event),
        onMouseUp: (event: { x: number; y: number }) => sessionDragHandlers.release(event),
      })}
      flexShrink={0}
      flexDirection="column"
      // Not clipped here: the tab strip and the title buttons sit on the border,
      // and a clipping frame does not paint them. The body clips instead.
      border
      borderStyle="single"
      borderColor={focused ? theme.cyan : theme.border}
      backgroundColor={theme.surface}
      title={` ${windowSurfaceTitle(surface)} `}
      titleColor={focused ? theme.cyan : theme.dim}
      onMouseDown={(event) => {
        if (event.button === 2) {
          openSurfaceWindowMenu(surface, index, event)
          return
        }
        if (event.button !== 0) return
        if (surfacePanelFocused) setSurfacePanelFocused(false)
        focusSplitPane(index)
        // The title row is the handle: dragging it moves the window.
        const frame = renderer.root.findDescendantById(index === FLOATING_PANE_INDEX ? 'floating-window' : `split-pane:${index}`) as unknown as { y: number } | null
        if (index === FLOATING_PANE_INDEX) { if (frame && event.y === frame.y) startFloatGesture('move', event); return }
        if (index >= 0 && frame && event.y === frame.y) {
          let clicks = surfaceTitleClicksRef.current.get(surface)
          if (!clicks) { clicks = { current: null }; surfaceTitleClicksRef.current.set(surface, clicks) }
          if (isDoubleClick(clicks, event)) toggleWindowZoom(index)
          else sessionDragImplRef.current.pressSurface(surface, index, event)
        }
      }}
    >
      {renderWindowTabs(surfaceWindowKey(surface), index, size.width, -1, 1, 16)}
      <box position="absolute" top={-1} right={1} height={1} flexDirection="row" zIndex={3}>
        <WindowButton id={`surface-window-menu:${surface}`} label=" ≡ " theme={theme} onPress={point => openWindowControlMenu(surfaceWindowKey(surface), point)} />
        <WindowButton id={`surface-window-to-panel:${surface}`} label={isPopoverWindowKind(surfaceKindOf(surface)) ? ' ⤢ ' : ' ⇥ panel '} theme={theme} onPress={() => moveSurfaceToPanel(surface)} />
        <WindowButton id={`surface-window-close:${surface}`} label=" × " theme={theme} tone="danger" onPress={() => closeSurfaceWindow(surface)} />
      </box>
      <box flexGrow={1} overflow="hidden">
        <RetainedWindow visible={!hidden}>
        {renderSurfaceBody(surfaceKindOf(surface), { width: Math.max(10, size.width - 2), height: Math.max(3, height - 2) }, () => closeSurfaceWindow(surface), focused && !composerActive, surface)}
        </RetainedWindow>
      </box>
    </box>
  )
}

export type RenderSurfaceLayerContext = {
  readerAreaWidth: number
  windowAreaHeight: number
  treeGeometry: { layout: WindowLayout; rects: Map<number, SplitRect>; dividers: SplitDivider[]; } | null
  visibleSplitPaneCount: number
  fittedWindows: WindowLayout
  splitOrientation: SplitPaneOrientation
  splitReaderLast: boolean
  fittedWindowKeys: string[]
  zoomedIndex: number | null
  rectOf: (id: string) => { x: number; y: number; width: number; height: number; } | null
  windowSurfaces: string[]
  liveWindowStacks: WindowStack[]
  floatingKey: string | null
  windowSurfacePeek: string | null
  renderSurfaceWindow: (surface: WindowSurfaceId, index: number, size: { width: number; height: number; boxHeight: number | undefined; }, hidden?: boolean, place?: { x: number; y: number; zIndex: number; }) => React.ReactNode
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  fullscreenMode: boolean
  windowStackFor: (key: string) => WindowStack | null
  zooming: boolean
}

export function runRenderSurfaceLayer(ctx: RenderSurfaceLayerContext) {
  const {
    readerAreaWidth, windowAreaHeight, treeGeometry, visibleSplitPaneCount, fittedWindows,
    splitOrientation, splitReaderLast, fittedWindowKeys, zoomedIndex, rectOf, windowSurfaces,
    liveWindowStacks, floatingKey, windowSurfacePeek, renderSurfaceWindow, floatingWindow,
    fullscreenMode, windowStackFor, zooming,
  } = ctx
  const area = { width: readerAreaWidth, height: windowAreaHeight }
  const rects = treeGeometry ? [treeGeometry.rects.get(-1)!, ...Array.from({ length: visibleSplitPaneCount }, (_, index) => treeGeometry!.rects.get(index)!)] : windowLayoutRects(fittedWindows, { ...area, orientation: splitOrientation, readerLast: splitReaderLast })
  const frameOf = (key: string): { index: number; rect: { x: number; y: number; width: number; height: number } } | null => {
    const index = fittedWindowKeys.indexOf(key)
    if (index < 0) return null
    if (zoomedIndex === index) return { index, rect: { x: 0, y: 0, ...area } }
    const parent = rectOf('window-area')
    const slot = rectOf(`split-pane:${index}`)
    if (parent && slot && slot.width > 0 && slot.height > 0) {
      return { index, rect: { x: slot.x - parent.x, y: slot.y - parent.y, width: slot.width, height: slot.height } }
    }
    const rect = rects[index + 1]
    return rect ? { index, rect } : null
  }
  const owned = new Set<WindowSurfaceId>([
    ...windowSurfaces,
    ...liveWindowStacks.flat().filter(isSurfaceWindowKey).map(surfaceIdOfKey),
    ...(floatingKey && isSurfaceWindowKey(floatingKey) ? [surfaceIdOfKey(floatingKey)] : []),
  ])
  return [...owned].sort().map((surface) => {
    const key = surfaceWindowKey(surface)
    if (windowSurfacePeek === surface) {
      return renderSurfaceWindow(surface, -1, { ...area, boxHeight: area.height }, false, { x: 0, y: 0, zIndex: 5 })
    }
    if (key === floatingKey && floatingWindow) {
      const rect = clampFloatingRect(floatingWindow.rect, area)
      const shown = !fullscreenMode && !windowSurfacePeek
      return renderSurfaceWindow(surface, FLOATING_PANE_INDEX, { width: rect.width, height: rect.height, boxHeight: rect.height }, !shown, { x: rect.x, y: rect.y, zIndex: 41 })
    }
    const own = frameOf(key)
    // A background tab sits hidden at its frame, so showing it is a visibility change.
    const frameKey = own ? key : windowStackFor(key)?.find((member) => fittedWindowKeys.includes(member))
    const at = own ?? (frameKey ? frameOf(frameKey) : null)
    const rect = at?.rect ?? { x: 0, y: 0, width: Math.max(10, area.width), height: Math.max(3, area.height) }
    const hidden = !own || Boolean(windowSurfacePeek) || fullscreenMode || (zooming && zoomedIndex !== own.index)
    return renderSurfaceWindow(surface, own ? own.index : -2, { width: rect.width, height: rect.height, boxHeight: rect.height }, hidden, { x: rect.x, y: rect.y, zIndex: 5 })
  })
}

export type RenderWindowTabsContext = {
  windowStackFor: (key: string) => WindowStack | null
  theme: TuiThemePalette
  sessionDragImplRef: React.RefObject<{ press: (_session: Session, _fromPane: number | null, _event: { x: number; y: number; }, _onClick?: () => void) => void; pressSurface: (_surface: WindowSurfaceId, _fromPane: number, _event: { x: number; y: number; }) => void; pressTab: (_key: string, _fromPane: number, _event: { x: number; y: number; }, _onClick?: () => void) => void; pressReader: (_session: Session, _event: { x: number; y: number; }) => void; move: (_event: { x: number; y: number; }) => void; release: (_event: { x: number; y: number; }) => void; }>
  activateWindowTab: (key: string) => void
  sessionDragHandlers: { press: (session: Session, fromPane: number | null, event: { x: number; y: number; }, onClick?: () => void) => void; move: (event: { x: number; y: number; }) => void; release: (event: { x: number; y: number; }) => void; }
  windowKeyTitle: (key: string) => string
  closeWindowTab: (key: string, remember?: boolean) => void
}

export function runRenderWindowTabs(ctx: RenderWindowTabsContext, key: string, index: number, frameWidth: number, top: number, left: number, reserve: number) {
  const {
    windowStackFor, theme, sessionDragImplRef, activateWindowTab, sessionDragHandlers,
    windowKeyTitle, closeWindowTab,
  } = ctx
  const stack = windowStackFor(key)
  if (!stack) return null
  const available = Math.max(8, frameWidth - reserve - left)
  const each = Math.max(6, Math.floor(available / stack.length))
  return (
    <box id={`window-tabs:${index}`} position="absolute" top={top} left={left} width={available} height={1} flexDirection="row" zIndex={4} backgroundColor={theme.surface} overflow="hidden">
      {stack.map((member) => {
        const active = member === key
        return (
          <box key={member} id={`window-tab:${member}`} flexDirection="row" flexShrink={0} width={each} height={1} backgroundColor={active ? theme.surface3 : theme.surface}
            onMouseDown={(event) => {
              if (event.button !== 0) return
              // Inside a surface frame the frame's own title handler would take
              // the press over as a drag of the whole window.
              event.stopPropagation()
              sessionDragImplRef.current.pressTab(member, index, event, () => activateWindowTab(member))
            }}
            // Until the gesture layer exists, the tab itself gets the drag and the release.
            onMouseDrag={(event) => sessionDragHandlers.move(event)}
            onMouseUp={(event) => sessionDragHandlers.release(event)}
          >
            <text fg={active ? theme.cyan : theme.muted} wrapMode="none" selectable={false}>{fitText(` ${windowKeyTitle(member)}`, each - 2)}</text>
            <WindowButton id={`window-tab-close:${member}`} label="× " theme={theme} tone="danger" onPress={() => closeWindowTab(member)} />
          </box>
        )
      })}
    </box>
  )
}
