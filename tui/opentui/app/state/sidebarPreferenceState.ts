/** @jsxImportSource @opentui/react */
import { useRef, useState } from 'react'
import { type TuiPluginCapture } from '../../shell/pluginTypes'
import { useWorkspaceState, useAppState } from '../../workspaceContext'
import { EMPTY_SURFACE_PANEL } from '../../surfacePanelState'
import { readTuiRuntimeActivity, type TuiSidebarSort } from '../../../../lib/tui/service'
import { type RunningSessionRef, type Session } from '../../../../lib/types'
import { type PendingInboxEdit } from '../types'
import { DEFAULT_SIDEBAR_WIDTH, TASK_PANEL_DEFAULT_WIDTH, SURFACE_PANEL_DEFAULT_WIDTH, SURFACE_PANEL_DEFAULT_ROWS } from '../layoutConstants'

export function useSidebarPreferenceState() {
  const [showToolCalls, setShowToolCalls] = useAppState('showToolCalls', true)
  const [velocityScrollEnabled, setVelocityScrollEnabled] = useAppState('velocityScrollEnabled', false)
  const [sidebarSort, setSidebarSort] = useState<TuiSidebarSort>('project')
  const [hideScratch, setHideScratch] = useState(false)
  const [showSettled, setShowSettled] = useState(false)
  const pendingInboxEditsRef = useRef<Map<string, PendingInboxEdit>>(new Map())
  const [sidebarView, setSidebarView] = useState<'sessions' | 'coordinator'>('sessions')
  const [sidebarWidthPreference, setSidebarWidthPreference] = useAppState('sidebarWidthPreference', DEFAULT_SIDEBAR_WIDTH)
  const [taskPanelWidth, setTaskPanelWidth] = useWorkspaceState('taskPanelWidth', TASK_PANEL_DEFAULT_WIDTH)
  const [taskPanelExpanded, setTaskPanelExpanded] = useWorkspaceState('taskPanelExpanded', false)
  // Surface panel: the terminal half of the web's right-hand panel. Open
  // surfaces live here; the panel is only *shown* when it is open, so the
  // reader keeps the full width until the user asks for it (⇧O).
  const [surfacePanelOpen, setSurfacePanelOpen] = useWorkspaceState('surfacePanelOpen', false)
  const [surfacePanelFocused, setSurfacePanelFocused] = useState(false)
  const [surfacePanelWidth, setSurfacePanelWidth] = useWorkspaceState('surfacePanelWidth', SURFACE_PANEL_DEFAULT_WIDTH)
  // Beside the reader (a column) or under it (a row), switched with `|` and kept in tui.json.
  const [surfacePanelPlacement, setSurfacePanelPlacement] = useWorkspaceState<'right' | 'bottom'>('surfacePanelPlacement', 'right')
  const [surfacePanelRows, setSurfacePanelRows] = useWorkspaceState('surfacePanelRows', SURFACE_PANEL_DEFAULT_ROWS)
  // A border drag in progress, and the last column/row the pointer was at.
  const [surfacePanelResizing, setSurfacePanelResizing] = useState(false)
  const surfacePanelResizeFromRef = useRef<number | null>(null)
  // Expanded: the panel takes everything the sidebar and the reader's minimum
  // leave. The reader stays mounted rather than being torn down — it keeps the
  // transcript's scroll position and its live-turn subscriptions alive, so
  // collapsing the panel again is instant instead of a full re-read.
  const [surfacePanelExpanded, setSurfacePanelExpanded] = useWorkspaceState('surfacePanelExpanded', false)
  const [surfacePanel, setSurfacePanel] = useWorkspaceState('surfacePanel', EMPTY_SURFACE_PANEL)
  const [surfaceBrowserRecent, setSurfaceBrowserRecent] = useWorkspaceState<string[]>('surfaceBrowserRecent', [])
  const surfacePanelKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  // The side panel's plugin surface: its key handler and its claim on input
  // (TuiPluginCapture). The Terminal claims `input` while a command is typed
  // (keys reach its <input>) and `terminal` while a shell has the keyboard
  // (every key goes to the shell, the panel's own chords included, until ⌃]).
  const surfacePluginKeyRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) | null>(null)
  const surfacePluginKeyCaptureRef = useRef<TuiPluginCapture>(false)
  const [sessions, setSessions] = useWorkspaceState<Session[]>('sessions', [], false)
  const sessionsRef = useRef<Session[]>([])
  const [runningSessions, setRunningSessions] = useState<RunningSessionRef[]>([])
  const [waitingSessions, setWaitingSessions] = useState<Awaited<ReturnType<typeof readTuiRuntimeActivity>>['waiting']>([])
  const [viewerAttentionNotes, setViewerAttentionNotes] = useState<Awaited<ReturnType<typeof readTuiRuntimeActivity>>['attention']>([])
  const [selectedSessionKey, setSelectedSessionKeyState] = useWorkspaceState<string | null>('selectedSessionKey', null)

  return {
    showToolCalls, setShowToolCalls, velocityScrollEnabled, setVelocityScrollEnabled, sidebarSort,
    setSidebarSort, hideScratch, setHideScratch, showSettled, setShowSettled, pendingInboxEditsRef,
    sidebarView, setSidebarView, sidebarWidthPreference, setSidebarWidthPreference, taskPanelWidth,
    setTaskPanelWidth, taskPanelExpanded, setTaskPanelExpanded, surfacePanelOpen,
    setSurfacePanelOpen, surfacePanelFocused, setSurfacePanelFocused, surfacePanelWidth,
    setSurfacePanelWidth, surfacePanelPlacement, setSurfacePanelPlacement, surfacePanelRows,
    setSurfacePanelRows, surfacePanelResizing, setSurfacePanelResizing, surfacePanelResizeFromRef,
    surfacePanelExpanded, setSurfacePanelExpanded, surfacePanel, setSurfacePanel,
    surfaceBrowserRecent, setSurfaceBrowserRecent, surfacePanelKeyHandlerRef, surfacePluginKeyRef,
    surfacePluginKeyCaptureRef, sessions, setSessions, sessionsRef, runningSessions,
    setRunningSessions, waitingSessions, setWaitingSessions, viewerAttentionNotes,
    setViewerAttentionNotes, selectedSessionKey, setSelectedSessionKeyState,
  }
}
