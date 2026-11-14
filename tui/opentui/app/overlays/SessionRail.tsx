/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import React, { useCallback, useRef } from 'react'
import { SpacesRail } from '../../SpacesNavigation'
import { type ScrollBoxRenderable } from '@opentui/core'
import { type TuiDensity } from '../../../theme'
import { type TuiSidebarSort } from '../../../../lib/tui/service'
import { type Session } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { Slot } from '../../slots'
import { type SidebarEntry, type PaneFocus } from '../types'
import { Spinner } from '../chrome'
import { SectionFrame } from '../borders'
import { PaneResizeHandle } from '../../paneResize'
import { SidebarTitlePreview } from '../SidebarTitlePreview'
import { SidebarHeading, SidebarNewSession, SidebarSortToggle, sidebarQuietColor } from '../SidebarChrome'

const SIDEBAR_VIEWS = ['sessions', 'coordinator'] as const

export function SessionRail({ showRail, sidebarWidth, sidebarExtraRows, mainContentHeight, sidebarView, effectiveFocus, theme, coordinatorSidebarHeader, sidebarHeaderBaseText, toggleSidebarSort, showToggleOutcome, sidebarSort, sidebarHeaderPrefixWidth, sidebarProviderBadgeText, sidebarProviderAccent, workspacesEnabled, openSpaces, fullScreenPopoverOpen, setAllProjects, allProjects, sidebarInnerWidth, sidebarRowBudget, density, sidebarScrollbarOptions, loadingSessions, sessions, sidebarEntries, sidebarScrollRef, sidebarRowElements, onNewSession, onViewChange, onFocus, controls, coordinatorControls, status, previewEnabled = effectiveFocus === 'sessions' }: {
  onViewChange: (view: 'sessions' | 'coordinator') => void
  onFocus?: () => void
  previewEnabled?: boolean
  controls?: React.ReactNode
  status?: React.ReactNode
  coordinatorControls?: React.ReactNode
  onNewSession: () => void
  showRail: boolean
  sidebarWidth: number
  sidebarExtraRows: number
  mainContentHeight: number
  sidebarView: 'sessions' | 'coordinator'
  effectiveFocus: PaneFocus
  theme: TuiThemePalette
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
}) {
  const savedSessionScroll = useRef(0)
  const bindSidebarScroll = useCallback((node: ScrollBoxRenderable | null) => {
    if (!node && sidebarScrollRef.current) savedSessionScroll.current = sidebarScrollRef.current.scrollTop
    sidebarScrollRef.current = node
    node?.scrollTo(savedSessionScroll.current)
  }, [sidebarScrollRef])
  return (
    showRail ? (
          <SectionFrame
            id="session-rail"
            theme={theme}
            surface={theme.surface}
            width={sidebarWidth}
            height={sidebarExtraRows > 0 ? mainContentHeight + sidebarExtraRows : '100%'}
            onMouseDown={event => { if (event.button === 0) onFocus?.() }}
            flexShrink={0}
            overflow={sidebarExtraRows > 0 ? 'hidden' : undefined}
            border={sidebarView === 'sessions' ? ['top', 'left', 'right', 'bottom'] : true}
            borderStyle="single"
            borderColor={effectiveFocus === 'sessions' ? theme.border2 : theme.border}
            focused={effectiveFocus === 'sessions'}
            backgroundColor={theme.surface}
            flexDirection="column"
            title={sidebarView === 'coordinator' ? coordinatorSidebarHeader : undefined}
            titleColor={theme.cyan}
          >
            <PaneResizeHandle kind="sidebar" extent={sidebarWidth} edge="right" inset={-1} color={effectiveFocus === 'sessions' ? theme.border2 : theme.border} />
            <box id="sidebar-tabs" height={1} flexShrink={0} paddingRight={1} flexDirection="row" overflow="hidden">
              {SIDEBAR_VIEWS.map(view => <box key={view} id={`sidebar-tab:${view}`} height={1} flexShrink={0}
                backgroundColor={sidebarView === view ? theme.surface3 : theme.surface}
                onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); onViewChange(view) } }}>
                <text fg={sidebarView === view ? theme.cyan : sidebarQuietColor(theme)} wrapMode="none" selectable={false}>{/* No left padding: a tab's own leading space puts its label in the gutter column the rows below start in. A narrow rail drops the tabs' trailing space so + New still fits beside them. */ `${view === 'sessions' ? ' Sessions' : ' Coordinator'}${sidebarWidth < 34 ? '' : ' '}`}</text>
              </box>)}
              <box flexGrow={1} />
              {sidebarView === 'sessions' ? <SidebarNewSession theme={theme} width={sidebarWidth} onPress={onNewSession} /> : null}
            </box>
            {sidebarView === 'sessions' ? <>
              <SidebarHeading theme={theme} width={sidebarWidth} text={sidebarHeaderBaseText} prefixWidth={sidebarHeaderPrefixWidth} badge={sidebarProviderBadgeText} accent={sidebarProviderAccent}
                onPress={() => { toggleSidebarSort(); showToggleOutcome('Sidebar sort:', sidebarSort === 'project' ? 'time' : 'project') }} />
              <SidebarSortToggle theme={theme} width={sidebarWidth} sort={sidebarSort}
                onPress={() => { toggleSidebarSort(); showToggleOutcome('Sidebar sort:', sidebarSort === 'project' ? 'time' : 'project') }} />
              {status}
            </> : null}
            {workspacesEnabled ? <SpacesRail theme={theme} width={sidebarWidth} onManage={openSpaces} under={fullScreenPopoverOpen} /> : null}
            {sidebarView === 'sessions' && controls ? controls : sidebarView === 'coordinator' && coordinatorControls ? coordinatorControls : <box id="sidebar-project-scope" height={1} flexShrink={0} paddingX={1} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); setAllProjects(value => !value) } }}><text fg={theme.muted} wrapMode="none" selectable={false}>{allProjects ? 'All projects ▾' : 'This project ▾'}</text></box>}
            <box flexGrow={1} minHeight={0} paddingX={1} flexDirection="column">
              {sidebarView === 'coordinator' ? (
                <Slot
                  name="sidebar_content"
                  theme={theme}
                  innerWidth={sidebarInnerWidth}
                  rowBudget={sidebarRowBudget}
                  density={density}
                  scrollbarOptions={sidebarScrollbarOptions}
                />
              ) : loadingSessions && sessions.length === 0 ? (
                <Spinner label={fitText('Loading…', sidebarInnerWidth - 2)} fg={theme.dim} />
              ) : sidebarEntries.length === 0 ? (
                <text fg={theme.dim}>{fitText(controls ? 'No sessions match filters' : 'No sessions available', sidebarInnerWidth)}</text>
              ) : (
                <SidebarTitlePreview theme={theme} width={sidebarWidth} height={mainContentHeight + sidebarExtraRows} enabled={previewEnabled}>
                  <scrollbox
                    ref={bindSidebarScroll}
                    flexGrow={1}
                    minHeight={0}
                    backgroundColor={theme.surface}
                    scrollY
                    viewportCulling
                    scrollbarOptions={sidebarScrollbarOptions}
                  >
                    {sidebarRowElements}
                  </scrollbox>
                </SidebarTitlePreview>
              )}
            </box>
          </SectionFrame>
        ) : null
  )
}
