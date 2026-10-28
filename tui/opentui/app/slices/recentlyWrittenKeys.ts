/** @jsxImportSource @opentui/react */
import type { WaitingSession } from '../../../../lib/sessionRuntime'
import type { ViewerAttentionNote } from '../../../../lib/viewerAttention'
import type { RefObject } from 'react'
import React, { useMemo, useRef } from 'react'
import { isPluginSurfaceId } from '../../../../lib/plugins/catalog'
import { type WindowSurfaceKind } from '../../windowSurfaceNames'
import { type AgentProvider, type RunningSessionRef, type Session } from '../../../../lib/types'
import { attentionItemNeedsInput, type AttentionItem } from '../../AttentionInboxPopover'
import { sessionKey } from '../sessionList'
import { FLEET_PAGE_SIZE } from '../commands'
import { pluginSurfaceWants } from '../pluginCommands'
import { runFleetEntries } from '../derived/fleet'
import { runSidebarSessionActivity } from '../derived/sidebar'

export type UseRecentlyWrittenKeysGroupContext = {
  recentlyWrittenSessions: { keys: ReadonlySet<string>; signature: string; nextExpiry: number | null; }
  attentionItems: AttentionItem[]
  runningSessions: RunningSessionRef[]
  waitingSessions: WaitingSession[]
  viewerAttentionNotes: ViewerAttentionNote[]
  pluginOverlay: 'terminal' | 'tasks' | 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'diagnostics' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null
  windowedPopoverKinds: Set<WindowSurfaceKind>
  sessionsByKeyRef: React.RefObject<Map<string, Session>>
  attentionDone: { key: string; sessionId: string; provider: AgentProvider; sessionKey: string; title: string; createdAt: number; }[]
  sessions: Session[]
  fleetStripEnabled: boolean
  presentationFocusMode: boolean
  fleetPage: number
}

export function useRecentlyWrittenKeysGroup(ctx: UseRecentlyWrittenKeysGroupContext) {
  const {
    recentlyWrittenSessions, attentionItems, runningSessions, waitingSessions,
    viewerAttentionNotes, pluginOverlay, windowedPopoverKinds, sessionsByKeyRef, attentionDone,
    sessions, fleetStripEnabled, presentationFocusMode, fleetPage,
  } = ctx

  const recentlyWrittenKeys = recentlyWrittenSessions.keys

  const sidebarSessionActivityRef = useRef(new Map<string, 'needs-input' | 'running' | 'waiting'>())
  const sidebarSessionActivity = useMemo(() => runSidebarSessionActivity({
    attentionItems, runningSessions, waitingSessions, viewerAttentionNotes,
    sidebarSessionActivityRef,
  }), [attentionItems, runningSessions, waitingSessions, viewerAttentionNotes])

  // The session fleet a plugin view reads (the desk's alert book among it).
  // Derived only while such a view is shown, full screen or in a window:
  // nothing else reads it, and the attention items change on every registry poll.
  const fleetViewShown = [...(pluginOverlay ? [pluginOverlay] : []), ...windowedPopoverKinds]
    .some((id) => isPluginSurfaceId(id) && pluginSurfaceWants(id, 'session-fleet'))
  const fleetAlerts = useMemo(() => (fleetViewShown ? attentionItems.map((item) => ({
    key: item.key,
    sessionKey: item.sessionKey,
    provider: item.provider,
    sessionTitle: item.sessionTitle,
    title: item.title,
    detail: item.detail,
    needsInput: attentionItemNeedsInput(item),
    createdAt: item.createdAt,
  })) : []), [attentionItems, fleetViewShown])

  // Fleet strip: one cell per live session (running or blocked on input) plus
  // recent background completions — mission-control ambient awareness while
  // reading any single transcript. Digits 1-9 jump to a cell; ⇧A toggles.
  const fleetEntries = useMemo(() => runFleetEntries({
    attentionItems, runningSessions, sessionsByKeyRef, waitingSessions, viewerAttentionNotes,
    attentionDone,
  }), [runningSessions, waitingSessions, viewerAttentionNotes, attentionItems, attentionDone, sessions])
  const fleetStripVisible = fleetStripEnabled && !presentationFocusMode && fleetEntries.length > 0
  const fleetPageCount = Math.max(Math.ceil(fleetEntries.length / FLEET_PAGE_SIZE), 1)
  const activeFleetPage = Math.min(fleetPage, fleetPageCount - 1)
  const visibleFleetEntries = useMemo(
    () => fleetEntries.slice(activeFleetPage * FLEET_PAGE_SIZE, (activeFleetPage + 1) * FLEET_PAGE_SIZE),
    [activeFleetPage, fleetEntries],
  )

  return {
    recentlyWrittenKeys, sidebarSessionActivity, fleetViewShown, fleetAlerts, fleetStripVisible,
    fleetPageCount, activeFleetPage, visibleFleetEntries,
  }
}
