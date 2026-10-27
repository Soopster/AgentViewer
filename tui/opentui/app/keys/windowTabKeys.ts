/** @jsxImportSource @opentui/react */
import type { KeyEvent } from '@opentui/core'
import type { WorkspaceContextValue } from '../../workspaceContext'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type Session, type SubagentSummary } from '../../../../lib/types'
import { type SidebarEntry, type SidebarSubagentEntry, type PaneFocus } from '../types'
import { SIDEBAR_RESIZE_STEP } from '../layoutConstants'
import { sessionKey } from '../sessionList'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

/** Returns true when one of these branches handled the key. */
export function handleWindowAndTabKeys({
  effectiveFocus, sequence, handled, jumpToBookmark, showRail, resizeSidebar, key,
  workspaceContext, sidebarView, selectedSession, childrenByParentId, setCollapsedSubagentParents,
  sidebarEntries, selectedSidebarEntryIndex, setSubagentTranscriptSelection, setPluginOverlay,
  promotePreviewToTab, setFocusedPane, showTabs, selectStripIndex, activeStripIndex,
  tabStripLength, shownPopoverTab, closePopoverTab, closeWindowSessionTab,
}: {
  effectiveFocus: PaneFocus
  sequence: string
  handled: (action: () => void) => void
  jumpToBookmark: (direction: 1 | -1) => void
  showRail: boolean
  resizeSidebar: (delta: number) => void
  key: KeyEvent
  workspaceContext: WorkspaceContextValue
  sidebarView: 'sessions' | 'coordinator'
  selectedSession: Session | null
  childrenByParentId: Map<string, SidebarSubagentEntry[]>
  setCollapsedSubagentParents: React.Dispatch<React.SetStateAction<string[]>>
  sidebarEntries: SidebarEntry[]
  selectedSidebarEntryIndex: number
  setSubagentTranscriptSelection: React.Dispatch<React.SetStateAction<{ parent: Session; agent: SubagentSummary; } | null>>
  setPluginOverlay: React.Dispatch<React.SetStateAction<'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'terminal' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null>>
  promotePreviewToTab: () => void
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  showTabs: boolean
  selectStripIndex: (index: number) => void
  activeStripIndex: number
  tabStripLength: number
  shownPopoverTab: string | null
  closePopoverTab: (id: WindowSurfaceId, keep?: boolean) => void
  closeWindowSessionTab: (session: Session) => void
}): boolean {
    // In the transcript, [ and ] jump between bookmarks. In the sidebar they
    // resize the rail (handled by the showRail blocks just below).
    if (effectiveFocus === 'messages' && sequence === ']') {
      handled(() => jumpToBookmark(1))
      return true
    }

    if (effectiveFocus === 'messages' && sequence === '[') {
      handled(() => jumpToBookmark(-1))
      return true
    }

    if (showRail && sequence === '[') {
      handled(() => {
        resizeSidebar(-SIDEBAR_RESIZE_STEP)
      })
      return true
    }

    if (showRail && sequence === ']') {
      handled(() => {
        resizeSidebar(SIDEBAR_RESIZE_STEP)
      })
      return true
    }

    // ⇧← / ⇧→ step through this space's workspaces; plain ← / → step through tabs.
    if (key.shift && !key.ctrl && !key.meta && (key.name === 'left' || key.name === 'right')) {
      const controller = workspaceContext.controller
      const state = controller.getSnapshot()
      const space = state.spaces.find(candidate => candidate.id === state.activeSpaceId)
      if (space && space.workspaces.length > 1) {
        handled(() => {
          const index = Math.max(0, space.workspaces.findIndex(workspace => workspace.id === space.activeWorkspaceId))
          const next = space.workspaces[Math.min(space.workspaces.length - 1, Math.max(0, index + (key.name === 'left' ? -1 : 1)))]!
          if (next.id !== space.activeWorkspaceId) controller.activate(space.id, next.id)
        })
        return true
      }
    }

    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && selectedSession
      && (key.name === 'left' || key.name === 'right') && (childrenByParentId.get(sessionKey(selectedSession))?.length ?? 0) > 0) {
      handled(() => {
        const parent = sessionKey(selectedSession)
        setCollapsedSubagentParents(previous => key.name === 'left' ? previous.includes(parent) ? previous : [...previous, parent] : previous.filter(value => value !== parent))
      })
      return true
    }
    if (effectiveFocus === 'sessions' && sidebarView === 'sessions' && key.name === 'return') {
      handled(() => {
        const entry = sidebarEntries[selectedSidebarEntryIndex]
        if (entry?.type === 'subagent' && entry.entry.kind === 'summary') {
          setSubagentTranscriptSelection({ parent: entry.parentSession, agent: entry.entry.summary })
          setPluginOverlay('subagents')
          return
        }
        promotePreviewToTab()
        setFocusedPane('messages')
      })
      return true
    }

    if (key.name === 'left' && showTabs) {
      handled(() => selectStripIndex(Math.max(activeStripIndex - 1, 0)))
      return true
    }

    if (key.name === 'right' && showTabs) {
      handled(() => selectStripIndex(Math.min(activeStripIndex + 1, tabStripLength - 1)))
      return true
    }

    if (effectiveFocus === 'messages' && key.name === 'w' && showTabs && shownPopoverTab) {
      const id = shownPopoverTab
      handled(() => closePopoverTab(id))
      return true
    }
    if (effectiveFocus === 'messages' && key.name === 'w' && !key.ctrl && !key.shift && !key.meta && selectedSession) {
      handled(() => closeWindowSessionTab(selectedSession))
      return true
    }
  return false
}
