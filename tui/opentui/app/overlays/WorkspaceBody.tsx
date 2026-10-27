/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import type { ReactNode } from 'react'
import type { ReactElement } from 'react'
import type { JSXElementConstructor } from 'react'
import type { WindowLayout } from '../../windowLayout'
import type { SplitRect } from '../../windowSplitTree'
import type { SplitDivider } from '../../windowSplitTree'
import type { OpenCodeTodo } from '../../../../lib/taskRegistry'
import type { PaletteCommand } from '../types'
import type { Toast } from '../../toastStore'
import { VerticalTabs } from '../../VerticalTabs'
import { tabStripWidth } from '../../tabStrip'
import { SessionTabConnection } from '../../SessionTabConnection'
import React from 'react'
import { surfaceTitle, type WindowSurfaceKind } from '../../windowSurfaceNames'
import { WorkspaceLauncher } from '../../SpacesNavigation'
import { type BoxRenderable, type ScrollBoxRenderable, type SelectOption, type TabSelectRenderable } from '@opentui/core'
import { formatSessionTitle, type TuiTranscriptCard } from '../../../format'
import { type ThreadedMessage } from '../../../../lib/threading'
import { type TuiDensity, type TuiThemeMode, type TuiTranscriptView } from '../../../theme'
import { writeTuiTabOrientation, type TuiSidebarSort } from '../../../../lib/tui/service'
import { type MessageBookmark } from '../../../../lib/messageBookmarks'
import { type ProviderSelection, type Session } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { type ChordMap } from '../../chordHelp'
import { type MenuPoint, type WindowItem, type SidebarEntry, type ModelPickerOption, type PaneFocus, type TuiCopilotContextTier, type ModelPickerFocus, type PaletteRow, type NoticeTone } from '../types'
import { type ThemeMenuGroup } from '../themes'
import { sessionKey } from '../sessionList'
import { type WindowSurfaceId, type SplitPaneHandle } from '../SplitTranscriptPane'
import { ThemeMenuOverlay } from './ThemeMenuOverlay'
import { CommandPaletteOverlay } from './CommandPaletteOverlay'
import { ChordHelpOverlay } from './ChordHelpOverlay'
import { TranscriptViewMenuOverlay } from './TranscriptViewMenuOverlay'
import { BookmarksOverlay } from './BookmarksOverlay'
import { SelectMenusOverlay } from './SelectMenusOverlay'
import { SessionRail } from './SessionRail'
import { TaskSidePanelFrame } from './TaskSidePanelFrame'

type WorkspaceBodyProps = {
  surfacePanelAtBottom: boolean
  mainContentHeight: number
  theme: TuiThemePalette
  showRail: boolean
  sidebarWidth: number
  sidebarExtraRows: number
  sidebarView: 'sessions' | 'coordinator'
  effectiveFocus: PaneFocus
  coordinatorSidebarHeader: string
  sidebarHeaderBaseText: string
  toggleSidebarSort: () => void
  showToggleOutcome: (label: string, outcome: string | boolean) => void
  sidebarSort: TuiSidebarSort
  sidebarHeaderPrefixWidth: number
  sidebarProviderBadgeText: string
  sidebarProviderAccent: string
  workspacesEnabled: boolean
  openSpaces: (id?: string, close?: boolean) => void
  fullScreenPopoverOpen: boolean
  setAllProjects: React.Dispatch<React.SetStateAction<boolean>>
  allProjects: boolean
  sidebarInnerWidth: number
  sidebarRowBudget: number
  density: TuiDensity
  sidebarScrollbarOptions: { trackOptions: { foregroundColor: string; backgroundColor: string; }; }
  loadingSessions: boolean
  sessions: Session[]
  sidebarEntries: SidebarEntry[]
  sidebarScrollRef: React.RefObject<ScrollBoxRenderable | null>
  sidebarRowElements: React.ReactNode[]
  showTabs: boolean
  verticalTabsWidth: number
  tabOptions: { name: string; description: string; value: string; }[]
  activeStripIndex: number
  runningTabKeys: Set<string>
  visibleTabSessions: Session[]
  closeSessionTab: (session: Session) => void
  popoverTabs: string[]
  closePopoverTab: (id: WindowSurfaceId, keep?: boolean) => void
  setTabOrientation: React.Dispatch<React.SetStateAction<'horizontal' | 'vertical'>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  splitPaneActions: { close: (paneIndex: number) => void; promote: (session: Session) => void; openLayout: () => void; fullscreen: () => void; sessionMenu: (session: Session, source: 'rail' | 'tab' | 'pane', point: MenuPoint, paneIndex?: number) => void; }
  openPopoverTabMenu: (id: WindowSurfaceId, point: { x: number; y: number; }) => void
  sessionDragHandlers: { press: (session: Session, fromPane: number | null, event: { x: number; y: number; }, onClick?: () => void) => void; move: (event: { x: number; y: number; }) => void; release: (event: { x: number; y: number; }) => void; }
  selectStripIndex: (index: number) => void
  readerAreaWidth: number
  showHorizontalTabs: boolean
  TAB_BAR_HEIGHT: 2
  tabSelectRef: React.RefObject<TabSelectRenderable | null>
  tabWidth: number
  popoverTabAt: (x: number) => WindowSurfaceId | null
  tabCloseHit: (x: number) => boolean
  showPopoverTab: (id: WindowSurfaceId) => void
  tabAt: (x: number) => Session | null
  selectTabSession: (session: Session) => void
  showPreviewBar: false
  selectedSession: Session | null
  previewBarText: string
  windowOverflowRows: number
  windowOverflowRef: React.RefObject<BoxRenderable | null>
  overflowWindowItems: WindowItem[]
  badgeForWindow: (key: string, compact?: boolean) => string | null
  pickWindowTarget: (key: string) => void
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  windowAreaRef: React.RefObject<BoxRenderable | null>
  workspaceLaunched: boolean
  workspaceCwd: string
  setWorkspaceLaunched: React.Dispatch<React.SetStateAction<boolean>>
  setWorkspaceHasSession: React.Dispatch<React.SetStateAction<boolean>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  setNewSessionCwd: React.Dispatch<React.SetStateAction<string>>
  setNewSessionModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  openSurfaceWindow: (kind: WindowSurfaceKind, options?: { another?: boolean; fromPanelId?: string; }) => void
  setWindowPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  windowSurfacePeek: string | null
  readerFrameNode: () => React.ReactNode
  hasPrimaryFrame: boolean
  orderedWindowKeys: string[]
  treeGeometry: { layout: WindowLayout; rects: Map<number, SplitRect>; dividers: SplitDivider[]; } | null
  windowItems: WindowItem[]
  windowHiddenByZoom: (index: number) => boolean
  popoverHostSlot: number
  windowItemKey: (item: WindowItem) => string
  zoomedIndex: number | null
  windowAreaHeight: number
  renderWindowItem: (item: WindowItem, index: number, size: { width: number; height: number; boxHeight: number | undefined; }, hidden?: boolean) => React.ReactNode
  zoomAware: (index: number, size: { width: number; height: number; boxHeight: number | undefined; }) => { width: number; height: number; boxHeight: number | undefined; }
  windowZoom: number | 'reader' | null
  zooming: boolean
  renderSurfaceLayer: () => React.ReactNode[]
  selectedWindowHandleRef: React.RefObject<(() => SplitPaneHandle | undefined) | null>
  selectedSessionKey: string | null
  windowControlsBlocked: boolean
  shownPopoverTab: string | null
  taskPanelVisible: boolean
  effectiveTaskPanelWidth: number
  effectiveSurfacePanelWidth: number
  surfacePanelHeight: number
  taskPanelMessages: ThreadedMessage[]
  composerLiveTodos: OpenCodeTodo[]
  visibleTranscriptCards: TuiTranscriptCard[]
  jumpToTranscriptIndex: (index: number) => void
  taskPanelTab: 'agents' | 'tasks'
  liveSubagentText: Record<string, string>
  surfacePanelOnRight: boolean
  surfacePanelElement: React.ReactNode
  themeMode: TuiThemeMode
  providerMenuOpen: boolean
  presentationFocusMode: boolean
  providerOptions: SelectOption[]
  providerMenuIndex: number
  setProviderMenuIndex: React.Dispatch<React.SetStateAction<number>>
  chooseProvider: (nextProvider: ProviderSelection, targetSession?: Session | null, nextInstanceId?: string | null) => Promise<void>
  modelPickerOpen: boolean
  width: number
  height: number
  composerAccentColor: string
  modelPickerTarget: Session | null
  modelPickerPermissionLabel: 'APPROVALS' | 'PERMISSIONS'
  modelPickerOptions: ModelPickerOption[]
  modelPickerIndex: number
  composerCopilotContextTier: TuiCopilotContextTier
  modelPickerFocus: ModelPickerFocus
  filteredModelPickerOptions: ModelPickerOption[]
  modelPickerLoading: boolean
  modelPickerError: string | null
  modelPickerQuery: string
  setModelPickerQuery: React.Dispatch<React.SetStateAction<string>>
  setModelPickerIndex: React.Dispatch<React.SetStateAction<number>>
  applyModelPickerOption: (selectedOption?: ModelPickerOption) => void
  compactModelPickerEffortOptions: { name: string; value: any; description: string; }[]
  modelPickerEffortIndex: number
  setModelPickerEffortIndex: React.Dispatch<React.SetStateAction<number>>
  applyModelPickerEffort: (value: string | undefined) => void
  compactModelPickerPermissionOptions: { name: string; value: any; description: string; }[]
  modelPickerPermissionIndex: number
  setModelPickerPermissionIndex: React.Dispatch<React.SetStateAction<number>>
  applyModelPickerPermission: (value: string | undefined) => void
  modelPickerFocusedLabel: 'APPROVALS' | 'PERMISSIONS' | 'MODEL' | 'EFFORT'
  modelPickerFocusedOption: SelectOption
  modelPickerFocusedDescription: string
  themeMenuOpen: boolean
  themeMenuOriginRef: React.RefObject<TuiThemeMode | null>
  themeMenuGroup: ThemeMenuGroup
  themeMenuQuery: string
  themeMenuIndex: number
  focusMode: boolean
  setThemeMenuQuery: React.Dispatch<React.SetStateAction<string>>
  setThemeMenuIndex: React.Dispatch<React.SetStateAction<number>>
  setThemeMode: React.Dispatch<React.SetStateAction<TuiThemeMode>>
  chooseTheme: (nextTheme: TuiThemeMode) => void
  themeFollowsTerminal: boolean
  transcriptViewMenuOpen: boolean
  transcriptViewMenuOriginRef: React.RefObject<TuiTranscriptView | null>
  transcriptViewMenuIndex: number
  setTranscriptViewMenuIndex: React.Dispatch<React.SetStateAction<number>>
  setTranscriptView: React.Dispatch<React.SetStateAction<TuiTranscriptView>>
  chooseTranscriptView: (nextView: TuiTranscriptView) => void
  lightweightWindows: boolean
  commandPaletteOpen: boolean
  filteredCommands: PaletteCommand[]
  paletteDisplayRows: PaletteRow[]
  commandPaletteIndex: number
  commandPaletteBodyRows: number
  commandPaletteTopOffset: 2 | 4
  commandPaletteQuery: string
  chordHelp: { map: ChordMap; dismissOnKey: boolean; } | null
  composerDockHeight: number
  composerStatusBlockHeight: number
  toasts: Toast[]
  bookmarksOverlayOpen: boolean
  bookmarksOverlay: MessageBookmark[]
  bookmarksOverlayIndex: number
}

export function WorkspaceBody(props: WorkspaceBodyProps) {
  const {
    surfacePanelAtBottom, mainContentHeight, theme, showRail, sidebarWidth, sidebarExtraRows,
    sidebarView, effectiveFocus, coordinatorSidebarHeader, sidebarHeaderBaseText,
    toggleSidebarSort, showToggleOutcome, sidebarSort, sidebarHeaderPrefixWidth,
    sidebarProviderBadgeText, sidebarProviderAccent, workspacesEnabled, openSpaces,
    fullScreenPopoverOpen, setAllProjects, allProjects, sidebarInnerWidth, sidebarRowBudget,
    density, sidebarScrollbarOptions, loadingSessions, sessions, sidebarEntries, sidebarScrollRef,
    sidebarRowElements, showTabs, verticalTabsWidth, tabOptions, activeStripIndex, runningTabKeys,
    visibleTabSessions, closeSessionTab, popoverTabs, closePopoverTab, setTabOrientation, setError,
    splitPaneActions, openPopoverTabMenu, sessionDragHandlers, selectStripIndex, readerAreaWidth,
    showHorizontalTabs, TAB_BAR_HEIGHT, tabSelectRef, tabWidth, popoverTabAt, tabCloseHit,
    showPopoverTab, tabAt, selectTabSession, showPreviewBar, selectedSession, previewBarText,
    windowOverflowRows, windowOverflowRef, overflowWindowItems, badgeForWindow, pickWindowTarget,
    showNotice, windowAreaRef, workspaceLaunched, workspaceCwd, setWorkspaceLaunched,
    setWorkspaceHasSession, setFocusedPane, setNewSessionCwd, setNewSessionModalOpen,
    openSurfaceWindow, setWindowPickerOpen, windowSurfacePeek, readerFrameNode, hasPrimaryFrame,
    orderedWindowKeys, treeGeometry, windowItems, windowHiddenByZoom, popoverHostSlot,
    windowItemKey, zoomedIndex, windowAreaHeight, renderWindowItem, zoomAware, windowZoom, zooming,
    renderSurfaceLayer, selectedWindowHandleRef, selectedSessionKey, windowControlsBlocked,
    shownPopoverTab, taskPanelVisible, effectiveTaskPanelWidth, effectiveSurfacePanelWidth,
    surfacePanelHeight, taskPanelMessages, composerLiveTodos, visibleTranscriptCards,
    jumpToTranscriptIndex, taskPanelTab, liveSubagentText, surfacePanelOnRight,
    surfacePanelElement, themeMode, providerMenuOpen, presentationFocusMode, providerOptions,
    providerMenuIndex, setProviderMenuIndex, chooseProvider, modelPickerOpen, width, height,
    composerAccentColor, modelPickerTarget, modelPickerPermissionLabel, modelPickerOptions,
    modelPickerIndex, composerCopilotContextTier, modelPickerFocus, filteredModelPickerOptions,
    modelPickerLoading, modelPickerError, modelPickerQuery, setModelPickerQuery,
    setModelPickerIndex, applyModelPickerOption, compactModelPickerEffortOptions,
    modelPickerEffortIndex, setModelPickerEffortIndex, applyModelPickerEffort,
    compactModelPickerPermissionOptions, modelPickerPermissionIndex, setModelPickerPermissionIndex,
    applyModelPickerPermission, modelPickerFocusedLabel, modelPickerFocusedOption,
    modelPickerFocusedDescription, themeMenuOpen, themeMenuOriginRef, themeMenuGroup,
    themeMenuQuery, themeMenuIndex, focusMode, setThemeMenuQuery, setThemeMenuIndex, setThemeMode,
    chooseTheme, themeFollowsTerminal, transcriptViewMenuOpen, transcriptViewMenuOriginRef,
    transcriptViewMenuIndex, setTranscriptViewMenuIndex, setTranscriptView, chooseTranscriptView,
    lightweightWindows, commandPaletteOpen, filteredCommands, paletteDisplayRows,
    commandPaletteIndex, commandPaletteBodyRows, commandPaletteTopOffset, commandPaletteQuery,
    chordHelp, composerDockHeight, composerStatusBlockHeight, toasts, bookmarksOverlayOpen,
    bookmarksOverlay, bookmarksOverlayIndex,
  } = props
  return (
    (
<box
        flexGrow={surfacePanelAtBottom ? 0 : 1}
        flexShrink={surfacePanelAtBottom ? 0 : undefined}
        // No padding or gap: frames meet the screen edge and each other, and
        // the docked composer follows this row directly.
        height={mainContentHeight}
        flexDirection="row"
        backgroundColor={theme.bg}
      >
        <SessionRail showRail={showRail} sidebarWidth={sidebarWidth} sidebarExtraRows={sidebarExtraRows} mainContentHeight={mainContentHeight} sidebarView={sidebarView} effectiveFocus={effectiveFocus} theme={theme} coordinatorSidebarHeader={coordinatorSidebarHeader} sidebarHeaderBaseText={sidebarHeaderBaseText} toggleSidebarSort={toggleSidebarSort} showToggleOutcome={showToggleOutcome} sidebarSort={sidebarSort} sidebarHeaderPrefixWidth={sidebarHeaderPrefixWidth} sidebarProviderBadgeText={sidebarProviderBadgeText} sidebarProviderAccent={sidebarProviderAccent} workspacesEnabled={workspacesEnabled} openSpaces={openSpaces} fullScreenPopoverOpen={fullScreenPopoverOpen} setAllProjects={setAllProjects} allProjects={allProjects} sidebarInnerWidth={sidebarInnerWidth} sidebarRowBudget={sidebarRowBudget} density={density} sidebarScrollbarOptions={sidebarScrollbarOptions} loadingSessions={loadingSessions} sessions={sessions} sidebarEntries={sidebarEntries} sidebarScrollRef={sidebarScrollRef} sidebarRowElements={sidebarRowElements} />

        {showTabs && verticalTabsWidth > 0 ? <VerticalTabs
          options={tabOptions} activeIndex={activeStripIndex} running={runningTabKeys}
          width={verticalTabsWidth} height={mainContentHeight} theme={theme}
          onClose={index => {
            if (index < visibleTabSessions.length) closeSessionTab(visibleTabSessions[index])
            else { const id = popoverTabs[index - visibleTabSessions.length]; if (id) closePopoverTab(id) }
          }}
          onHorizontal={() => {
            setTabOrientation('horizontal')
            void writeTuiTabOrientation('horizontal').catch(err => setError(String(err)))
          }}
          onPress={(index, event) => {
            const session = visibleTabSessions[index]
            if (event.button === 2) {
              event.stopPropagation()
              if (session) splitPaneActions.sessionMenu(session, 'tab', event)
              else { const id = popoverTabs[index - visibleTabSessions.length]; if (id) openPopoverTabMenu(id, event) }
            } else if (event.button === 0) {
              if (session) sessionDragHandlers.press(session, null, event, () => selectStripIndex(index))
              else selectStripIndex(index)
            }
          }}
          onDrag={event => sessionDragHandlers.move(event)}
          onRelease={event => { if (event.button === 0) sessionDragHandlers.release(event) }}
        /> : null}
        <box width={readerAreaWidth} flexDirection="column">
          {showHorizontalTabs ? (
            <box
              id="session-tab-strip"
              height={TAB_BAR_HEIGHT}
              paddingTop={1}
              flexShrink={0}
              paddingX={1}
              overflow="hidden"
              backgroundColor={theme.bg}
            >
              <tab-select
                id="session-tabs"
                ref={tabSelectRef}
                options={tabOptions}
                width={tabStripWidth(readerAreaWidth)}
                height={1}
                tabWidth={tabWidth}
                backgroundColor={theme.bg}
                focusedBackgroundColor={theme.surface3}
                textColor={theme.muted}
                focusedTextColor={theme.text}
                selectedBackgroundColor={theme.surface}
                selectedTextColor={theme.cyan}
                selectedDescriptionColor={theme.dim}
                showDescription={false}
                showUnderline={false}
                showScrollArrows={true}
                wrapSelection={false}
                // A tab opens on release, and a press that moves drags it onto the
                // window area, as a rail row does.
                onMouseDown={(event) => {
                  const popoverTab = popoverTabAt(event.x)
                  if (popoverTab) {
                    event.stopPropagation()
                    if (event.button === 2) openPopoverTabMenu(popoverTab, event)
                    else if (event.button === 0 && tabCloseHit(event.x)) closePopoverTab(popoverTab)
                    else if (event.button === 0) showPopoverTab(popoverTab)
                    return
                  }
                  if (event.button === 2) {
                    const tab = tabAt(event.x)
                    if (tab) splitPaneActions.sessionMenu(tab, 'tab', event)
                    return
                  }
                  if (event.button !== 0) return
                  const tab = tabAt(event.x)
                  if (tab && tabCloseHit(event.x)) {
                    event.stopPropagation()
                    event.preventDefault()
                    closeSessionTab(tab)
                    return
                  }
                  if (tab) sessionDragHandlers.press(tab, null, event, () => selectTabSession(tab))
                }}
                onMouseDrag={(event) => sessionDragHandlers.move(event)}
                onMouseUp={(event) => {
                  if (event.button !== 0) return
                  sessionDragHandlers.release(event)
                }}
                onChange={(index: number) => selectStripIndex(index)}
              />
            </box>
          ) : showPreviewBar && selectedSession ? (
            <box paddingX={1} backgroundColor={theme.surface2}>
              <text fg={theme.cyan} wrapMode="none">{previewBarText}</text>
            </box>
          ) : null}

          {/* Reader + split panes share one frame area. Side-by-side lays it
              out as columns; stacked as rows, which is the only shape a split
              can take on a terminal too narrow for two 46-column frames. */}
          {/* Reader + split panes share one frame area, laid out by the
              window arrangement: along one axis (the tmux-style split, which
              is the only shape a narrow terminal can take), the reader beside
              a stack, or a grid. */}
          {windowOverflowRows > 0 ? (
            <box id="window-overflow" ref={windowOverflowRef} height={1} flexShrink={0} flexDirection="row" overflow="hidden" backgroundColor={theme.surface2}>
              <text fg={theme.amber} width={` +${overflowWindowItems.length} hidden · `.length} flexShrink={0} wrapMode="none">{` +${overflowWindowItems.length} hidden · `}</text>
              {overflowWindowItems.map((item, index) => {
                const title = fitText(item.kind === 'session' ? `${badgeForWindow(sessionKey(item.session)) ? `${badgeForWindow(sessionKey(item.session), true)} · ` : ''}${formatSessionTitle(item.session)}` : surfaceTitle(item.surface), 24).trimEnd()
                const label = `${index > 0 ? ' · ' : ''}${title}`
                return (
                  <box key={item.kind === 'session' ? sessionKey(item.session) : item.surface} width={label.length} flexShrink={0}
                    onMouseDown={(event) => {
                      if (event.button !== 0) return
                      event.stopPropagation()
                      if (item.kind === 'session') pickWindowTarget(sessionKey(item.session))
                      else showNotice('info', `${surfaceTitle(item.surface)} is preserved · enlarge the terminal to restore it`)
                    }}>
                    <text fg={theme.muted} wrapMode="none" selectable={false}>{label}</text>
                  </box>
                )
              })}
              <text fg={theme.dim} flexShrink={0} wrapMode="none"> · enlarge to restore</text>
            </box>
          ) : null}
          <box
            id="window-area"
            ref={windowAreaRef}
            flexDirection="row"
            flexGrow={1}
          >
          {workspacesEnabled && !workspaceLaunched ? (
            <WorkspaceLauncher theme={theme} cwd={workspaceCwd}
              onOpenSession={() => { setWorkspaceLaunched(true); setWorkspaceHasSession(true); setFocusedPane('sessions') }}
              onNewAgent={() => { setWorkspaceLaunched(true); setWorkspaceHasSession(true); setNewSessionCwd(workspaceCwd); setNewSessionModalOpen(true) }}
              onTerminal={() => { setWorkspaceLaunched(true); openSurfaceWindow('terminal') }}
              onLayout={() => { setWorkspaceLaunched(true); setWindowPickerOpen(true) }} />
          ) : windowSurfacePeek ? (
            // The surface layer draws the peeked window over the whole area.
            <box visible={false}>{readerFrameNode()}</box>
          ) : !hasPrimaryFrame && orderedWindowKeys.length === 0 ? (
            <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
              <text fg={theme.dim}>No panes open</text>
              <box onMouseDown={event => { if (event.button !== 0) return; event.stopPropagation(); setWorkspaceHasSession(true); setFocusedPane('sessions') }}><text fg={theme.cyan} selectable={false}>Open session from the sidebar</text></box>
            </box>
          ) : treeGeometry ? (
            <>
              {windowItems.map((item, index) => {
                const rect = treeGeometry!.rects.get(index)!
                // The reader draws this window (below, under the window's id).
                const hidden = windowHiddenByZoom(index) || index === popoverHostSlot
                return <box key={windowItemKey(item)} position="absolute" left={zoomedIndex === index ? 0 : rect.x} top={zoomedIndex === index ? 0 : rect.y}
                  width={zoomedIndex === index ? readerAreaWidth : rect.width} height={zoomedIndex === index ? windowAreaHeight : rect.height}
                  visible={!hidden} flexDirection="column">
                  {renderWindowItem(item, index, zoomAware(index, { width: rect.width, height: rect.height, boxHeight: rect.height }), hidden)}
                </box>
              })}
              {/* The window the reader draws carries that window's id, so anything that
                  finds a window by id (splits, drops, control mode) finds it here. */}
              {/* The popover tab, over the window it took (or in its own slot). */}
              <box key="tree-reader" position="absolute" left={windowZoom === 'reader' ? 0 : (treeGeometry.rects.get(-1)?.x ?? 0)} top={windowZoom === 'reader' ? 0 : (treeGeometry.rects.get(-1)?.y ?? 0)}
                width={windowZoom === 'reader' ? readerAreaWidth : treeGeometry.rects.get(-1)?.width ?? 0} height={windowZoom === 'reader' ? windowAreaHeight : treeGeometry.rects.get(-1)?.height ?? 0}
                visible={hasPrimaryFrame && (!zooming || windowZoom === 'reader')} flexDirection="row">{hasPrimaryFrame ? readerFrameNode() : null}</box>
            </>
          ) : (
            // Full screen with nothing selected: only a popover tab can be shown.
            readerFrameNode()
          )}
          {renderSurfaceLayer()}
          <SessionTabConnection tabs={tabSelectRef} readWindow={() => selectedWindowHandleRef.current?.()?.frame() ?? null}
            ownerKey={selectedSessionKey} enabled={showHorizontalTabs && !windowControlsBlocked && !fullScreenPopoverOpen && !shownPopoverTab}
            foreground={theme.cyan} background={theme.surface} />

          </box>
        </box>

        {/* Reserve the task-panel column in flow, then extend its frame through
            the docked composer so both share the right-hand column. */}
        {taskPanelVisible ? <box width={effectiveTaskPanelWidth} /> : null}
        <TaskSidePanelFrame taskPanelVisible={taskPanelVisible} effectiveSurfacePanelWidth={effectiveSurfacePanelWidth} effectiveTaskPanelWidth={effectiveTaskPanelWidth} surfacePanelHeight={surfacePanelHeight} taskPanelMessages={taskPanelMessages} composerLiveTodos={composerLiveTodos} selectedSession={selectedSession} theme={theme} visibleTranscriptCards={visibleTranscriptCards} jumpToTranscriptIndex={jumpToTranscriptIndex} taskPanelTab={taskPanelTab} liveSubagentText={liveSubagentText} />

        {/* Width reservation only — the panel itself is positioned absolutely
            below so it can share the full-height right-hand column. */}
        {surfacePanelOnRight ? (
          <box width={effectiveSurfacePanelWidth} />
        ) : null}

        {surfacePanelOnRight ? (
          // Beside the reader it spans the right-hand column, composer rows included.
          <box
            id="surface-panel-frame"
            position="absolute"
            top={0}
            right={0}
            width={effectiveSurfacePanelWidth}
            height={surfacePanelHeight}
            overflow="hidden"
            zIndex={5}
          >
            {surfacePanelElement}
          </box>
        ) : null}


        <SelectMenusOverlay themeMode={themeMode} theme={theme} providerMenuOpen={providerMenuOpen} presentationFocusMode={presentationFocusMode} providerOptions={providerOptions} providerMenuIndex={providerMenuIndex} setProviderMenuIndex={setProviderMenuIndex} chooseProvider={chooseProvider} modelPickerOpen={modelPickerOpen} width={width} height={height} composerAccentColor={composerAccentColor} modelPickerTarget={modelPickerTarget} modelPickerPermissionLabel={modelPickerPermissionLabel} modelPickerOptions={modelPickerOptions} modelPickerIndex={modelPickerIndex} composerCopilotContextTier={composerCopilotContextTier} modelPickerFocus={modelPickerFocus} filteredModelPickerOptions={filteredModelPickerOptions} modelPickerLoading={modelPickerLoading} modelPickerError={modelPickerError} modelPickerQuery={modelPickerQuery} setModelPickerQuery={setModelPickerQuery} setModelPickerIndex={setModelPickerIndex} applyModelPickerOption={applyModelPickerOption} compactModelPickerEffortOptions={compactModelPickerEffortOptions} modelPickerEffortIndex={modelPickerEffortIndex} setModelPickerEffortIndex={setModelPickerEffortIndex} applyModelPickerEffort={applyModelPickerEffort} compactModelPickerPermissionOptions={compactModelPickerPermissionOptions} modelPickerPermissionIndex={modelPickerPermissionIndex} setModelPickerPermissionIndex={setModelPickerPermissionIndex} applyModelPickerPermission={applyModelPickerPermission} modelPickerFocusedLabel={modelPickerFocusedLabel} modelPickerFocusedOption={modelPickerFocusedOption} modelPickerFocusedDescription={modelPickerFocusedDescription} />

        <ThemeMenuOverlay themeMenuOpen={themeMenuOpen} themeMenuOriginRef={themeMenuOriginRef} height={height} themeMenuGroup={themeMenuGroup} themeMenuQuery={themeMenuQuery} themeMenuIndex={themeMenuIndex} focusMode={focusMode} setThemeMenuQuery={setThemeMenuQuery} setThemeMenuIndex={setThemeMenuIndex} setThemeMode={setThemeMode} chooseTheme={chooseTheme} themeFollowsTerminal={themeFollowsTerminal} />

        <TranscriptViewMenuOverlay transcriptViewMenuOpen={transcriptViewMenuOpen} width={width} transcriptViewMenuOriginRef={transcriptViewMenuOriginRef} focusMode={focusMode} theme={theme} transcriptViewMenuIndex={transcriptViewMenuIndex} setTranscriptViewMenuIndex={setTranscriptViewMenuIndex} setTranscriptView={setTranscriptView} chooseTranscriptView={chooseTranscriptView} lightweightWindows={lightweightWindows} />

        <CommandPaletteOverlay commandPaletteOpen={commandPaletteOpen} width={width} filteredCommands={filteredCommands} paletteDisplayRows={paletteDisplayRows} commandPaletteIndex={commandPaletteIndex} commandPaletteBodyRows={commandPaletteBodyRows} commandPaletteTopOffset={commandPaletteTopOffset} theme={theme} commandPaletteQuery={commandPaletteQuery} />

        <ChordHelpOverlay chordHelp={chordHelp} width={width} height={height} composerDockHeight={composerDockHeight} composerStatusBlockHeight={composerStatusBlockHeight} toasts={toasts} theme={theme} />

        <BookmarksOverlay bookmarksOverlayOpen={bookmarksOverlayOpen} width={width} bookmarksOverlay={bookmarksOverlay} focusMode={focusMode} height={height} bookmarksOverlayIndex={bookmarksOverlayIndex} theme={theme} />

      </box>
)
  )
}
