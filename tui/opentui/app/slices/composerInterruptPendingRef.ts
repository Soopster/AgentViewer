/** @jsxImportSource @opentui/react */
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import React, { useRef, useState, useSyncExternalStore } from 'react'
import { surfaceKindOf } from '../../windowSurfaceNames'
import { type FloatingRect, type WindowStack } from '../../windowTabs'
import { isSurfaceWindowKey, surfaceIdOfKey } from '../../windowOrder'
import { type TextareaRenderable } from '@opentui/core'
import { type ThreadedMessage } from '../../../../lib/threading'
import { type Session } from '../../../../lib/types'
import { type RemoteCoordinatorTarget } from '../../../../lib/tui/remoteCoordinator'
import { isInteractiveCoordinatorOpen, subscribeInteractiveCoordinator } from '../../interactiveCoordinatorStore'
import { type TranscriptDiffNoteDraft } from '../transcriptDiffSelection'
import { useNavigationRefs } from '../state/navigationRefs'

export type UseComposerInterruptPendingRefGroupContext = {
  composerSessions: { get<T>(key: string, name: string, initial: T | (() => T)): T; set<T>(key: string, name: string, initial: T | (() => T), action: React.SetStateAction<T>): void; subscribe(key: string, name: string, listener: () => void): () => void; ref<T>(key: string, name: string, initial: T): React.MutableRefObject<T>; peekRef<T>(key: string, name: string): React.MutableRefObject<T> | undefined; same(a: string, b: string): boolean; rekey(from: string, to: string): void; keys(): string[]; }
  composerOwnerKey: string
  windowSurfaces: string[]
  popoverTabs: string[]
  windowStacks: WindowStack[]
  floatingWindow: { key: string; rect: FloatingRect; slot: number; } | null
  spacesMenuOpen: boolean
  exitConfirmOpen: boolean
  searchMode: boolean
  sessionSearchMode: boolean
  pluginOverlay: 'tasks' | 'terminal' | 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'diagnostics' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null
  pluginManagerOpen: boolean
  windowSwitcherOpen: boolean
  windowBroadcastOpen: boolean
  handoffBriefOpen: boolean
  promptLibraryOpen: boolean
  bookmarksOverlayOpen: boolean
  coordModalOpen: boolean
  renameSessionKey: string | null
  surfacePanelFocused: boolean
  newSessionModalOpen: boolean
  providerMenuOpen: boolean
  modelPickerOpen: boolean
  themeMenuOpen: boolean
  transcriptViewMenuOpen: boolean
  commandPaletteOpen: boolean
  transcriptDiffDraft: TranscriptDiffNoteDraft | null
}

export function useComposerInterruptPendingRefGroup(ctx: UseComposerInterruptPendingRefGroupContext) {
  const {
    composerSessions, composerOwnerKey, windowSurfaces, popoverTabs, windowStacks, floatingWindow,
    spacesMenuOpen, exitConfirmOpen, searchMode, sessionSearchMode, pluginOverlay,
    pluginManagerOpen, windowSwitcherOpen, windowBroadcastOpen, handoffBriefOpen,
    promptLibraryOpen, bookmarksOverlayOpen, coordModalOpen, renameSessionKey, surfacePanelFocused,
    newSessionModalOpen, providerMenuOpen, modelPickerOpen, themeMenuOpen, transcriptViewMenuOpen,
    commandPaletteOpen, transcriptDiffDraft,
  } = ctx

  // Set by cancelComposerSend so the send's AbortError handler transitions into
  // the awaitingPersistedTurn 'Syncing…' reconcile (confirmed interrupt) rather
  // than discarding the interrupted turn's partial output outright.
  const composerInterruptPendingRef = composerSessions.ref(composerOwnerKey, 'composerInterruptPendingRef', false)
  const composerTextareaRef = useRef<TextareaRenderable | null>(null)
  const composerPastePartTypeIdRef = useRef<number | null>(null)
  const composerCursorOffsetRef = useRef<number | null>(null)
  const terminalSelectionRef = useRef<{ text: string; capturedAt: number } | null>(null)
  const liveToolIndexesRef = composerSessions.ref<Map<number, string>>(composerOwnerKey, 'liveToolIndexesRef', new Map())
  const liveToolInputJsonRef = composerSessions.ref<Map<number, string>>(composerOwnerKey, 'liveToolInputJsonRef', new Map())
  const liveTranscriptBaselineRef = useRef(new Map<string, {
    count: number
    lastFingerprint: string | null
    sequenceFingerprint: string
    startedAt: number
  }>())
  const liveTranscriptMessagesRef = useRef<ThreadedMessage[]>([])
  const awaitingPersistedTurnRef = composerSessions.ref(composerOwnerKey, 'awaitingPersistedTurnRef', false)
  const liveTextFlushTimerRef = composerSessions.ref<ReturnType<typeof setTimeout> | null>(composerOwnerKey, 'liveTextFlushTimerRef', null)
  const pendingLiveTextRef = composerSessions.ref(composerOwnerKey, 'pendingLiveTextRef', '')
  const pendingLiveReasoningRef = composerSessions.ref(composerOwnerKey, 'pendingLiveReasoningRef', '')
  const liveTextTargetSessionRef = composerSessions.ref<Session | null>(composerOwnerKey, 'liveTextTargetSessionRef', null)
  const {
    loadingDetailRef, foregroundLoadInFlightRef, pendingForegroundLoadRef, navSelectStartRef,
    navPaintedKeyRef, navDetailSetAtRef, backgroundRefreshInFlightRef, sessionDetailMtimeRef,
    selectedSessionKeyRef, openTabSessionsRef, runningSessionsRef, tabsEnabledRef,
    themeMenuOriginRef, transcriptViewMenuOriginRef, currentThemeRef, exitConfirmOpenRef,
    exitInProgressRef, densityRef, showToolCallsRef, transcriptDiffHoverTimeoutRef,
    composerActiveRef, composerDraftRef, searchModeRef, sessionSearchModeRef,
  } = useNavigationRefs()
  // Whether the session-scoped Teammates panel is up. The panel holds its own
  // state in interactiveCoordinatorStore, so this selector is the root's only
  // subscription to it: a coordinator refresh repaints the panel and never
  // reaches this component, and only opening or closing re-renders the root.
  const teammatesOpen = useSyncExternalStore(
    subscribeInteractiveCoordinator,
    isInteractiveCoordinatorOpen,
    () => false,
  )
  const teammatesKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  // Popover kinds that are windows now (laid out, a background tab, or floating).
  // A store-backed popover stays "open" while it is a window — its feed must
  // run — so its modal is suppressed instead of closed.
  const windowedPopoverKinds = new Set([
    ...windowSurfaces,
    ...popoverTabs,
    ...windowStacks.flat().filter(isSurfaceWindowKey).map(surfaceIdOfKey),
    ...(floatingWindow && isSurfaceWindowKey(floatingWindow.key) ? [surfaceIdOfKey(floatingWindow.key)] : []),
  ].map(surfaceKindOf))
  const teammatesModalOpen = teammatesOpen && !windowedPopoverKinds.has('teammates')
  const [remoteCoordinatorTarget, setRemoteCoordinatorTarget] = useState<RemoteCoordinatorTarget | null>(null)
  const remoteCoordinatorKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)

  const composerFocusBlocked = Boolean(
    spacesMenuOpen
    || exitConfirmOpen
    || searchMode
    || sessionSearchMode
    || pluginOverlay !== null
    || pluginManagerOpen
    || windowSwitcherOpen
    || windowBroadcastOpen
    || handoffBriefOpen
    || promptLibraryOpen
    || bookmarksOverlayOpen
    || coordModalOpen
    || teammatesModalOpen
    || remoteCoordinatorTarget
    || renameSessionKey
    || surfacePanelFocused
    || newSessionModalOpen
    || providerMenuOpen
    || modelPickerOpen
    || themeMenuOpen
    || transcriptViewMenuOpen
    || commandPaletteOpen
    || transcriptDiffDraft,
  )

  return {
    composerInterruptPendingRef, composerTextareaRef, composerPastePartTypeIdRef,
    composerCursorOffsetRef, terminalSelectionRef, liveToolIndexesRef, liveToolInputJsonRef,
    liveTranscriptBaselineRef, liveTranscriptMessagesRef, awaitingPersistedTurnRef,
    liveTextFlushTimerRef, pendingLiveTextRef, pendingLiveReasoningRef, liveTextTargetSessionRef,
    loadingDetailRef, foregroundLoadInFlightRef, pendingForegroundLoadRef, navSelectStartRef,
    navPaintedKeyRef, navDetailSetAtRef, backgroundRefreshInFlightRef, sessionDetailMtimeRef,
    selectedSessionKeyRef, openTabSessionsRef, runningSessionsRef, tabsEnabledRef,
    themeMenuOriginRef, transcriptViewMenuOriginRef, currentThemeRef, exitConfirmOpenRef,
    exitInProgressRef, densityRef, showToolCallsRef, transcriptDiffHoverTimeoutRef,
    composerActiveRef, composerDraftRef, searchModeRef, sessionSearchModeRef, teammatesOpen,
    teammatesKeyHandlerRef, windowedPopoverKinds, teammatesModalOpen, remoteCoordinatorTarget,
    setRemoteCoordinatorTarget, remoteCoordinatorKeyHandlerRef, composerFocusBlocked,
  }
}
