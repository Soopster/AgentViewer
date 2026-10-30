/** @jsxImportSource @opentui/react */
import type { TuiThemePalette } from '../../../theme'
import React from 'react'
import { SpacesRail } from '../../SpacesNavigation'
import { TextAttributes, type ScrollBoxRenderable } from '@opentui/core'
import { type TuiDensity } from '../../../theme'
import { type TuiSidebarSort } from '../../../../lib/tui/service'
import { type Session } from '../../../../lib/types'
import { fitText } from '../../textLayout'
import { Slot } from '../../slots'
import { type SidebarEntry, type PaneFocus } from '../types'
import { Spinner } from '../chrome'
import { SectionFrame } from '../borders'

export function SessionRail({ showRail, sidebarWidth, sidebarExtraRows, mainContentHeight, sidebarView, effectiveFocus, theme, coordinatorSidebarHeader, sidebarHeaderBaseText, toggleSidebarSort, showToggleOutcome, sidebarSort, sidebarHeaderPrefixWidth, sidebarProviderBadgeText, sidebarProviderAccent, workspacesEnabled, openSpaces, fullScreenPopoverOpen, setAllProjects, allProjects, sidebarInnerWidth, sidebarRowBudget, density, sidebarScrollbarOptions, loadingSessions, sessions, sidebarEntries, sidebarScrollRef, sidebarRowElements }: {
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
  return (
    showRail ? (
          <SectionFrame
            id="session-rail"
            theme={theme}
            surface={theme.surface}
            width={sidebarWidth}
            height={sidebarExtraRows > 0 ? mainContentHeight + sidebarExtraRows : undefined}
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
            {sidebarView === 'sessions' ? (
              // Painted into the top border, where a title goes, rather than
              // on a row of its own under it: the rail's first row is a session.
              // It stays a box because the provider badge and the click that
              // toggles the sort need one; a `title` string can carry neither.
              <box
                position="absolute"
                top={-1}
                left={1}
                width={sidebarHeaderBaseText.trimEnd().length + 2}
                height={1}
                paddingX={1}
                flexDirection="row"
                backgroundColor={theme.surface}
                overflow="hidden"
                onMouseDown={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  toggleSidebarSort()
                  showToggleOutcome('Sidebar sort:', sidebarSort === 'project' ? 'time' : 'project')
                }}
              >
                <text fg={theme.cyan} bg={theme.surface} wrapMode="none">
                  {sidebarHeaderBaseText.trimEnd()}
                </text>
                <box
                  id="sidebar-provider-badge"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: sidebarHeaderPrefixWidth + 1,
                    width: sidebarProviderBadgeText.length,
                    minWidth: sidebarProviderBadgeText.length,
                    maxWidth: sidebarProviderBadgeText.length,
                    height: 1,
                    overflow: 'hidden',
                  }}
                  backgroundColor={sidebarProviderAccent}
                >
                  <text
                    width={sidebarProviderBadgeText.length}
                    minWidth={sidebarProviderBadgeText.length}
                    maxWidth={sidebarProviderBadgeText.length}
                    fg={theme.bg}
                    attributes={TextAttributes.BOLD}
                    wrapMode="none"
                  >
                    {sidebarProviderBadgeText}
                  </text>
                </box>
              </box>
            ) : null}
            {workspacesEnabled ? <SpacesRail theme={theme} width={sidebarWidth} onManage={openSpaces} under={fullScreenPopoverOpen} /> : null}
            <box height={1} onMouseDown={event => { if (event.button === 0) { event.stopPropagation(); setAllProjects(value => !value) } }}><text fg={theme.dim}>{allProjects ? 'All projects · click to scope' : 'Project sessions · click for all'}</text></box>
            <box flexGrow={1} paddingX={1}>
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
                <text fg={theme.dim}>{fitText('No sessions available', sidebarInnerWidth)}</text>
              ) : (
                <scrollbox
                  ref={sidebarScrollRef}
                  style={{ height: sidebarRowBudget }}
                  backgroundColor={theme.surface}
                  scrollY
                  viewportCulling
                  scrollbarOptions={sidebarScrollbarOptions}
                >
                  {sidebarRowElements}
                </scrollbox>
              )}
            </box>
          </SectionFrame>
        ) : null
  )
}
