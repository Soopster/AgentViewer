/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { CliRenderer } from '@opentui/core'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { TranscriptIndexLookup } from '../transcriptIndex'
import type { SurfacePanelState } from '../../surfacePanelState'
import type { WorkspaceContextValue } from '../../workspaceContext'
import { type WindowPresentation } from '../../windowPresentation'
import React from 'react'
import { type WindowSplitTree } from '../../windowSplitTree'
import { type SurfaceMeta } from '../../popoverWindows'
import { type FloatingRect, type WindowStack } from '../../windowTabs'
import { type WindowGroupKey, type WindowArrangement } from '../../windowLayout'
import { useWorkspaceState } from '../../workspaceContext'
import { WindowHistory } from '../../windowHistory'
import { type TextareaRenderable } from '@opentui/core'
import { type TuiTranscriptCard } from '../../../format'
import { readTuiAllBookmarks, type TuiSessionDetail } from '../../../../lib/tui/service'
import { type MessageBookmark } from '../../../../lib/messageBookmarks'
import { type ProtocolRunSnapshot } from '../../../../lib/agentProtocol'
import { useStableEvent } from '../../useStableEvent'
import { type SendAttachment, type Session } from '../../../../lib/types'
import { getContinueInCliCommand } from '../../../../lib/cliContinue'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { type ComposerPromptPart, type ComposerDraftSnapshot, type PaneFocus, type NoticeTone } from '../types'
import { writeClipboard } from '../clipboard'
import { sessionKey } from '../sessionList'
import { runRestoreWindowSnapshot } from '../actions/windows'
import { runToggleBookmarkForCursor, runCopySelectedMessage, runReplySelectedMessage } from '../actions/interaction'

export type UseCopySelectedMessageGroupContext = {
  terminalSelectionRef: React.RefObject<{ text: string; capturedAt: number; } | null>
  renderer: CliRenderer
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  readCursorIndex: () => number
  visibleTranscriptCards: TuiTranscriptCard[]
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerDraft: string
  applyComposerSnapshot: (snapshot: ComposerDraftSnapshot) => void
  composerMentionAttachments: SendAttachment[]
  composerPromptParts: ComposerPromptPart[]
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  selectedSessionTarget: Session | null
  bookmarkKeysRef: React.RefObject<Set<string>>
  setBookmarkKeys: React.Dispatch<React.SetStateAction<Set<string>>>
  readerTitle: string
  jumpToTranscriptIndex: (index: number) => void
  setBookmarksOverlayOpen: React.Dispatch<React.SetStateAction<boolean>>
  setBookmarksOverlayIndex: React.Dispatch<React.SetStateAction<number>>
  setBookmarksOverlay: React.Dispatch<React.SetStateAction<MessageBookmark[]>>
  setHandoffBriefOpen: React.Dispatch<React.SetStateAction<boolean>>
  rememberComposerCursor: () => void
  setPromptLibraryOpen: React.Dispatch<React.SetStateAction<boolean>>
  canUseChannelBridge: boolean
  setRouteComposerToBridge: React.Dispatch<React.SetStateAction<boolean>>
  canUseIdeBridge: boolean
  setRouteComposerToIde: React.Dispatch<React.SetStateAction<boolean>>
  insertComposerTextAtCursor: (textToInsert: string) => void
  selectedSessionKeyRef: React.RefObject<string | null>
  transcriptIndexByKey: TranscriptIndexLookup
  pendingBookmarkCursorRef: React.RefObject<{ sessionKey: string; uuid: string; } | null>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  selectTabSession: (session: Session) => void
  selectedSession: Session | null
  sessionDetail: TuiSessionDetail | null
  splitArrangement: WindowArrangement
  splitOrientation: SplitPaneOrientation
  splitReaderLast: boolean
  splitReaderShare: number
  splitSecondaryShare: number
  splitBottomShare: number
  splitWeights: Partial<Record<WindowGroupKey, number[]>>
  reconciledSplitTree: WindowSplitTree | null
  splitPaneCount: number
  splitPinnedKeys: string[]
  windowSurfaces: string[]
  windowOrder: string[]
  popoverTabs: string[]
  activePopoverTab: string | null
  windowStacks: WindowStack[]
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  windowSurfaceMeta: Record<string, SurfaceMeta>
  selectedSessionKey: string | null
  windowZoom: number | 'reader' | null
  fullscreenMode: boolean
  windowPresentation: WindowPresentation | null
  coordinatorWorkspaceRunId: string | null
  coordinatorWorkspace: ProtocolRunSnapshot | null
  openTabSessions: Session[]
  splitFocusIndex: number | null
  surfacePanel: SurfacePanelState
  surfacePanelOpen: boolean
  windowResizeGroupRef: React.RefObject<boolean>
  windowResizeCheckpointRef: React.RefObject<boolean>
  setCoordinatorWorkspace: React.Dispatch<React.SetStateAction<ProtocolRunSnapshot | null>>
  setCoordinatorWorkspaceRunId: React.Dispatch<React.SetStateAction<string | null>>
  liveWindowStacks: WindowStack[]
  floatingKey: string | null
  workspaceContext: WorkspaceContextValue
  setWindowSurfacePeek: React.Dispatch<React.SetStateAction<string | null>>
  setOpenTabSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setWorkspaceHasSession: React.Dispatch<React.SetStateAction<boolean>>
  setWorkspaceReaderSession: (session: Session | null) => void
  setSelectedSessionKey: React.Dispatch<React.SetStateAction<string | null>>
  setSplitPinnedKeys: React.Dispatch<React.SetStateAction<string[]>>
  setSplitPaneCount: React.Dispatch<React.SetStateAction<number>>
  setWindowSplitTree: React.Dispatch<React.SetStateAction<WindowSplitTree | null>>
  setSplitArrangement: React.Dispatch<React.SetStateAction<WindowArrangement>>
  setSplitOrientation: React.Dispatch<React.SetStateAction<SplitPaneOrientation>>
  setSplitReaderLast: React.Dispatch<React.SetStateAction<boolean>>
  setSplitReaderShare: React.Dispatch<React.SetStateAction<number>>
  setSplitSecondaryShare: React.Dispatch<React.SetStateAction<number>>
  setSplitBottomShare: React.Dispatch<React.SetStateAction<number>>
  setSplitWeights: React.Dispatch<React.SetStateAction<Partial<Record<WindowGroupKey, number[]>>>>
  setWindowSurfaces: React.Dispatch<React.SetStateAction<string[]>>
  setWindowOrder: React.Dispatch<React.SetStateAction<string[]>>
  setPopoverTabs: React.Dispatch<React.SetStateAction<string[]>>
  setActivePopoverTab: React.Dispatch<React.SetStateAction<string | null>>
  setWindowStacks: React.Dispatch<React.SetStateAction<WindowStack[]>>
  setFloatingWindow: React.Dispatch<React.SetStateAction<{ key: string; rect: FloatingRect; slot: number; } | null>>
  setWindowSurfaceMeta: React.Dispatch<React.SetStateAction<Record<string, SurfaceMeta>>>
  setWindowZoom: React.Dispatch<React.SetStateAction<number | 'reader' | null>>
  setFullscreenMode: React.Dispatch<React.SetStateAction<boolean>>
  setSplitFocusIndex: React.Dispatch<React.SetStateAction<number | null>>
  setSurfacePanel: React.Dispatch<React.SetStateAction<SurfacePanelState>>
  setSurfacePanelOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSurfacePanelFocused: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setWindowPresentation: React.Dispatch<React.SetStateAction<WindowPresentation | null>>
}

export function useCopySelectedMessageGroup(ctx: UseCopySelectedMessageGroupContext) {
  const {
    terminalSelectionRef, renderer, showNotice, readCursorIndex, visibleTranscriptCards,
    composerTextareaRef, composerDraft, applyComposerSnapshot, composerMentionAttachments,
    composerPromptParts, setComposerActive, selectedSessionTarget, bookmarkKeysRef,
    setBookmarkKeys, readerTitle, jumpToTranscriptIndex, setBookmarksOverlayOpen,
    setBookmarksOverlayIndex, setBookmarksOverlay, setHandoffBriefOpen, rememberComposerCursor,
    setPromptLibraryOpen, canUseChannelBridge, setRouteComposerToBridge, canUseIdeBridge,
    setRouteComposerToIde, insertComposerTextAtCursor, selectedSessionKeyRef, transcriptIndexByKey,
    pendingBookmarkCursorRef, setFocusedPane, selectTabSession, selectedSession, sessionDetail,
    splitArrangement, splitOrientation, splitReaderLast, splitReaderShare, splitSecondaryShare,
    splitBottomShare, splitWeights, reconciledSplitTree, splitPaneCount, splitPinnedKeys,
    windowSurfaces, windowOrder, popoverTabs, activePopoverTab, windowStacks, floatingWindow,
    windowSurfaceMeta, selectedSessionKey, windowZoom, fullscreenMode, windowPresentation,
    coordinatorWorkspaceRunId, coordinatorWorkspace, openTabSessions, splitFocusIndex,
    surfacePanel, surfacePanelOpen, windowResizeGroupRef, windowResizeCheckpointRef,
    setCoordinatorWorkspace, setCoordinatorWorkspaceRunId, liveWindowStacks, floatingKey,
    workspaceContext, setWindowSurfacePeek, setOpenTabSessions, setWorkspaceHasSession,
    setWorkspaceReaderSession, setSelectedSessionKey, setSplitPinnedKeys, setSplitPaneCount,
    setWindowSplitTree, setSplitArrangement, setSplitOrientation, setSplitReaderLast,
    setSplitReaderShare, setSplitSecondaryShare, setSplitBottomShare, setSplitWeights,
    setWindowSurfaces, setWindowOrder, setPopoverTabs, setActivePopoverTab, setWindowStacks,
    setFloatingWindow, setWindowSurfaceMeta, setWindowZoom, setFullscreenMode, setSplitFocusIndex,
    setSurfacePanel, setSurfacePanelOpen, setSurfacePanelFocused, setError, setWindowPresentation,
  } = ctx

  const copySelectedMessage = useStableEvent(async (cardOverride?: TuiTranscriptCard) => runCopySelectedMessage({
    terminalSelectionRef, renderer, showNotice, readCursorIndex, visibleTranscriptCards,
  }, cardOverride))

  const replySelectedMessage = useStableEvent((cardOverride?: TuiTranscriptCard) => runReplySelectedMessage({
    readCursorIndex, visibleTranscriptCards, showNotice, composerTextareaRef, composerDraft,
    applyComposerSnapshot, composerMentionAttachments, composerPromptParts, setComposerActive,
  }, cardOverride))

  // Toggle a bookmark on the card under the transcript cursor.
  const toggleBookmarkForCursor = useStableEvent(async () => runToggleBookmarkForCursor({
    selectedSessionTarget, showNotice, readCursorIndex, visibleTranscriptCards, bookmarkKeysRef,
    setBookmarkKeys, readerTitle,
  }))

  // Jump to the next/previous bookmarked card in the active session.
  const jumpToBookmark = useStableEvent((direction: 1 | -1) => {
    if (visibleTranscriptCards.length === 0) return
    const marks = bookmarkKeysRef.current
    if (marks.size === 0) { showNotice('info', 'No bookmarks in this session'); return }
    const cursorIndex = readCursorIndex()
    const start = cursorIndex >= 0 ? cursorIndex : 0
    const count = visibleTranscriptCards.length
    for (let step = 1; step <= count; step += 1) {
      const idx = (((start + direction * step) % count) + count) % count
      const card = visibleTranscriptCards[idx]
      if (card && marks.has(card.key)) {
        jumpToTranscriptIndex(idx)
        return
      }
    }
  })

  const openBookmarksOverlay = useStableEvent(async () => {
    setBookmarksOverlayOpen(true)
    setBookmarksOverlayIndex(0)
    try {
      const all = await readTuiAllBookmarks()
      setBookmarksOverlay(all)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to load bookmarks')
    }
  })

  const openHandoffBrief = useStableEvent(() => {
    if (!selectedSessionTarget) {
      showNotice('error', 'No session selected')
      return
    }
    setHandoffBriefOpen(true)
  })

  const openPromptLibrary = useStableEvent(() => {
    if (!selectedSessionTarget) {
      showNotice('error', 'No session selected')
      return
    }
    rememberComposerCursor()
    setComposerActive(true)
    setPromptLibraryOpen(true)
  })

  const toggleComposerBridgeRoute = useStableEvent(() => {
    if (!canUseChannelBridge) {
      showNotice('error', 'Select a Claude session to route the composer through the channel bridge')
      return
    }
    setRouteComposerToBridge((on) => {
      const next = !on
      showNotice('info', next ? 'Composer now routes to the live CLI bridge' : 'Composer back to the active provider')
      return next
    })
  })

  const toggleComposerIdeRoute = useStableEvent(() => {
    if (!canUseIdeBridge) {
      showNotice('error', 'Select a Claude session to route the composer through the IDE bridge')
      return
    }
    setRouteComposerToIde((on) => {
      const next = !on
      showNotice('info', next ? 'Composer now pushes @mentions to the IDE session' : 'Composer back to the active provider')
      return next
    })
  })

  const insertComposerPromptText = useStableEvent((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const renderable = composerTextareaRef.current
    const current = renderable?.plainText ?? composerDraft
    const cursor = renderable?.cursorOffset ?? current.length
    const before = current.slice(0, cursor)
    const insertion = before.length > 0 && !before.endsWith('\n') ? `\n${trimmed}` : trimmed
    insertComposerTextAtCursor(insertion)
    setComposerActive(true)
  })

  // Navigate to a bookmark from the global overlay — switching session (and
  // provider) when needed, then landing on the message once it has loaded.
  const openBookmarkRecord = useStableEvent((record: MessageBookmark) => {
    setBookmarksOverlayOpen(false)
    const targetSession = { sessionId: record.sessionId, provider: record.provider } as Session
    const targetKey = sessionKey(targetSession)
    if (targetKey === selectedSessionKeyRef.current) {
      const idx = transcriptIndexByKey.get(record.uuid)
      if (idx !== undefined && idx >= 0) jumpToTranscriptIndex(idx)
      else pendingBookmarkCursorRef.current = { sessionKey: targetKey, uuid: record.uuid }
      setFocusedPane('messages')
      return
    }
    pendingBookmarkCursorRef.current = { sessionKey: targetKey, uuid: record.uuid }
    selectTabSession(targetSession)
    setFocusedPane('messages')
  })

  const copyCliCommand = useStableEvent(async () => {
    const session = selectedSession
    if (!session) { showNotice('error', 'No session selected'); return }
    const cwd = sessionDetail?.info?.cwd ?? session.cwd
    const cmd = getContinueInCliCommand(session.provider ?? 'claude', session.sessionId, cwd)
    if (!cmd) { showNotice('error', `No CLI resume command for ${session.provider}`); return }
    try {
      await writeClipboard(cmd, renderer)
      showNotice('info', `Copied: ${cmd}`)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to copy')
    }
  })

  // Checkpoint user operations rather than renders: polling, focus changes,
  // startup hydration and terminal resizes must never fill the undo stack.
  const captureWindowLayout = useStableEvent(() => ({
    layout: {
      arrangement: splitArrangement, orientation: splitOrientation,
      readerLast: splitReaderLast, readerShare: splitReaderShare,
      secondaryShare: splitSecondaryShare, bottomShare: splitBottomShare, weights: splitWeights,
      splitTree: reconciledSplitTree,
      count: splitPaneCount, panes: [...splitPinnedKeys], surfaces: [...windowSurfaces], order: [...windowOrder],
      popoverTabs: [...popoverTabs], activePopoverTab, stacks: windowStacks.map((stack) => [...stack]), floating: floatingWindow, surfaceMeta: { ...windowSurfaceMeta },
      primaryOpen: false, reader: selectedSessionKey, zoom: windowZoom, fullscreen: fullscreenMode, presentation: windowPresentation,
      coordinatorRunId: coordinatorWorkspaceRunId,
    },
    reader: selectedSession,
    workspace: coordinatorWorkspace,
    workspaceRunId: coordinatorWorkspaceRunId,
    tabs: openTabSessions,
    focus: splitFocusIndex,
    panel: surfacePanel,
    panelOpen: surfacePanelOpen,
  }))
  const [windowHistory] = useWorkspaceState('windowHistory', () => new WindowHistory<ReturnType<typeof captureWindowLayout>>(
    (snapshot) => JSON.stringify(snapshot.layout),
  ), false)
  const checkpointWindowLayout = useStableEvent(() => {
    if (windowResizeGroupRef.current) {
      if (windowResizeCheckpointRef.current) return
      windowResizeCheckpointRef.current = true
    } else windowResizeCheckpointRef.current = false
    windowHistory.checkpoint(captureWindowLayout())
  })
  const restoreWindowSnapshot = useStableEvent((previous: ReturnType<typeof captureWindowLayout>) => {
    runRestoreWindowSnapshot({
    captureWindowLayout, setCoordinatorWorkspace, setCoordinatorWorkspaceRunId, windowSurfaces,
    liveWindowStacks, floatingKey, surfacePanel, workspaceContext, setWindowSurfacePeek,
    setOpenTabSessions, selectedSessionKey, setWorkspaceHasSession, setWorkspaceReaderSession,
    setSelectedSessionKey, setSplitPinnedKeys, setSplitPaneCount, setWindowSplitTree,
    setSplitArrangement, setSplitOrientation, setSplitReaderLast, setSplitReaderShare,
    setSplitSecondaryShare, setSplitBottomShare, setSplitWeights, setWindowSurfaces,
    setWindowOrder, setPopoverTabs, setActivePopoverTab, setWindowStacks, setFloatingWindow,
    setWindowSurfaceMeta, setWindowZoom, setFullscreenMode, setSplitFocusIndex, setSurfacePanel,
    setSurfacePanelOpen, setSurfacePanelFocused, setError,
  }, previous)
    setWindowPresentation(previous.layout.presentation ?? null)
  })

  return {
    copySelectedMessage, replySelectedMessage, toggleBookmarkForCursor, jumpToBookmark,
    openBookmarksOverlay, openHandoffBrief, openPromptLibrary, toggleComposerBridgeRoute,
    toggleComposerIdeRoute, insertComposerPromptText, openBookmarkRecord, copyCliCommand,
    captureWindowLayout, windowHistory, checkpointWindowLayout, restoreWindowSnapshot,
  }
}
