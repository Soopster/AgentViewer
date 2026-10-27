/** @jsxImportSource @opentui/react */
import type { WorkspaceContextValue } from '../../workspaceContext'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type WindowGroupKey, type WindowArrangement } from '../../windowLayout'
import { readTuiSurfacePanelPlacement, readTuiWindowArrangement } from '../../../../lib/tui/service'
import { type RefObject } from 'react'
import { type CliRenderer } from '@opentui/core'
import { setActiveTheme, type TuiDensity, type TuiThemeMode, type TuiTranscriptView } from '../../../theme'
import { readTuiDensity, readTuiDiffLayout, readTuiFocusMode, readTuiStickyHeaders, readTuiLightweightWindows, readTuiProvider, readTuiProviderInstances, readTuiRailVisible, readTuiSidebarSort, readTuiHideScratchSessions, readTuiSidebarWidth, readTuiShowToolCalls, readTuiTabsEnabled, readTuiTabOrientation, readTuiSplitPanes, readTuiSplitOrientation, readTuiSplitReaderShare, readTuiDaemonWarning, readTuiTheme, readTuiThemeFollow, readTuiTranscriptView, readTuiTranscriptWidth, readTuiVelocityScroll, type TuiProviderInstanceChoice, type TuiDiffLayout, type TuiSidebarSort, type TuiTranscriptWidth } from '../../../../lib/tui/service'
import { type ProviderSelection } from '../../../../lib/types'
import { type SplitPaneOrientation } from '../../splitPaneState'
import { type PaneFocus, type NoticeTone } from '../types'
import { coordinatorAlertDelivery } from '../../../../lib/coordinatorSignals'
import { subscribeInteractiveCoordinatorNotifications, getInteractiveCoordinatorNotifications } from '../../interactiveCoordinatorStore'
import { findTuiWorktreeTask, type WorktreeTask } from '../../../../lib/tui/service'
import { WORKTREE_TASK_CWD_SEGMENT } from '../layoutConstants'

export type SurfacePlacementEffectContext = {
  workspaceContext: WorkspaceContextValue
  setSurfacePanelPlacement: React.Dispatch<React.SetStateAction<'right' | 'bottom'>>
  setSplitArrangement: React.Dispatch<React.SetStateAction<WindowArrangement>>
  setSplitReaderLast: React.Dispatch<React.SetStateAction<boolean>>
  setSplitSecondaryShare: React.Dispatch<React.SetStateAction<number>>
  setSplitBottomShare: React.Dispatch<React.SetStateAction<number>>
  setSplitWeights: React.Dispatch<React.SetStateAction<Partial<Record<WindowGroupKey, number[]>>>>
}

export function runSurfacePlacementEffect(ctx: SurfacePlacementEffectContext) {
  const {
    workspaceContext, setSurfacePanelPlacement, setSplitArrangement, setSplitReaderLast,
    setSplitSecondaryShare, setSplitBottomShare, setSplitWeights,
  } = ctx
  let cancelled = false
  void readTuiSurfacePanelPlacement().then((placement) => { if (!cancelled && !workspaceContext.runtime.restoredKeys.has('surfacePanelPlacement')) setSurfacePanelPlacement(placement) }).catch(() => {})
  void readTuiWindowArrangement().then((stored) => {
    if (cancelled) return
    if (workspaceContext.runtime.restoredKeys.has('splitArrangement') || workspaceContext.runtime.values.get('legacyInitialWorkspace') !== true) return
    setSplitArrangement(stored.arrangement)
    setSplitReaderLast(stored.readerLast)
    setSplitSecondaryShare(stored.secondaryShare)
    setSplitBottomShare(stored.bottomShare)
    setSplitWeights(stored.weights ?? {})
  }).catch(() => {})
  return () => { cancelled = true }
}

export type ThemeFollowEffectContext = {
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  themeSlotsRef: React.RefObject<{ light: TuiThemeMode; dark: TuiThemeMode; }>
  themeFollowsTerminalRef: React.RefObject<boolean>
  setThemeFollowsTerminal: React.Dispatch<React.SetStateAction<boolean>>
  renderer: CliRenderer
  setThemeMode: React.Dispatch<React.SetStateAction<TuiThemeMode>>
  workspaceContext: WorkspaceContextValue
  provider: ProviderSelection
  providerInstanceId: string | null
  providerInstanceIdRef: React.RefObject<string | null>
  setProviderInstanceId: React.Dispatch<React.SetStateAction<string | null>>
  setProviderInstances: React.Dispatch<React.SetStateAction<TuiProviderInstanceChoice[]>>
  setProvider: React.Dispatch<React.SetStateAction<ProviderSelection>>
  setRailVisible: React.Dispatch<React.SetStateAction<boolean>>
  setFocusMode: React.Dispatch<React.SetStateAction<boolean>>
  setStickyHeaders: React.Dispatch<React.SetStateAction<boolean>>
  setLightweightWindows: React.Dispatch<React.SetStateAction<boolean>>
  setDensity: React.Dispatch<React.SetStateAction<TuiDensity>>
  setDiffLayout: React.Dispatch<React.SetStateAction<TuiDiffLayout>>
  setTranscriptView: React.Dispatch<React.SetStateAction<TuiTranscriptView>>
  setTranscriptWidth: React.Dispatch<React.SetStateAction<TuiTranscriptWidth>>
  setTabsEnabled: React.Dispatch<React.SetStateAction<boolean>>
  setTabOrientation: React.Dispatch<React.SetStateAction<'horizontal' | 'vertical'>>
  setSidebarSort: React.Dispatch<React.SetStateAction<TuiSidebarSort>>
  setHideScratch: React.Dispatch<React.SetStateAction<boolean>>
  setSidebarWidthPreference: React.Dispatch<React.SetStateAction<number>>
  setShowToolCalls: React.Dispatch<React.SetStateAction<boolean>>
  setVelocityScrollEnabled: React.Dispatch<React.SetStateAction<boolean>>
  setSplitPaneCount: React.Dispatch<React.SetStateAction<number>>
  setSplitOrientation: React.Dispatch<React.SetStateAction<SplitPaneOrientation>>
  setSplitReaderShare: React.Dispatch<React.SetStateAction<number>>
  setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>
  refreshSessions: (nextProvider: ProviderSelection, preserveSelection?: boolean, foreground?: boolean) => Promise<void>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setLoadingSessions: React.Dispatch<React.SetStateAction<boolean>>
  setBootstrapped: React.Dispatch<React.SetStateAction<boolean>>
}

export function runThemeFollowEffect(ctx: ThemeFollowEffectContext) {
  const {
    showNotice, themeSlotsRef, themeFollowsTerminalRef, setThemeFollowsTerminal, renderer,
    setThemeMode, workspaceContext, provider, providerInstanceId, providerInstanceIdRef,
    setProviderInstanceId, setProviderInstances, setProvider, setRailVisible, setFocusMode,
    setStickyHeaders, setLightweightWindows, setDensity, setDiffLayout, setTranscriptView,
    setTranscriptWidth, setTabsEnabled, setTabOrientation, setSidebarSort, setHideScratch,
    setSidebarWidthPreference, setShowToolCalls, setVelocityScrollEnabled, setSplitPaneCount,
    setSplitOrientation, setSplitReaderShare, setFocusedPane, refreshSessions, setError,
    setLoadingSessions, setBootstrapped,
  } = ctx
  let cancelled = false

  void (async () => {
    try {
      const [
        configuredTheme,
        configuredProvider,
        configuredRailVisible,
        configuredFocusMode,
        configuredDensity,
        configuredDiffLayout,
        configuredTranscriptView,
        configuredTranscriptWidth,
        configuredTabsEnabled,
        configuredTabOrientation,
        configuredSidebarSort,
        configuredHideScratch,
        configuredSidebarWidth,
        configuredShowToolCalls,
        configuredVelocityScroll,
        configuredSplitPanes,
        configuredSplitOrientation,
        configuredSplitReaderShare,
        configuredStickyHeaders,
        configuredThemeFollow,
        configuredLightweightWindows,
      ] = await Promise.all([
        readTuiTheme(),
        readTuiProvider(),
        readTuiRailVisible(),
        readTuiFocusMode(),
        readTuiDensity(),
        readTuiDiffLayout(),
        readTuiTranscriptView(),
        readTuiTranscriptWidth(),
        readTuiTabsEnabled(),
        readTuiTabOrientation(),
        readTuiSidebarSort(),
        readTuiHideScratchSessions(),
        readTuiSidebarWidth(),
        readTuiShowToolCalls(),
        readTuiVelocityScroll(),
        readTuiSplitPanes(),
        readTuiSplitOrientation(),
        readTuiSplitReaderShare(),
        readTuiStickyHeaders(),
        readTuiThemeFollow(),
        readTuiLightweightWindows(),
      ])
      if (cancelled) return
      // Attached to a daemon that may be older than this client: say so once,
      // rather than letting each feature fail with its own HTTP error.
      void readTuiDaemonWarning().then((warning) => {
        if (!cancelled && warning) showNotice('error', warning, 10000)
      }).catch(() => {})
      themeSlotsRef.current = {
        light: configuredThemeFollow.light ?? 'light',
        dark: configuredThemeFollow.dark ?? 'dark',
      }
      themeFollowsTerminalRef.current = configuredThemeFollow.follow
      setThemeFollowsTerminal(configuredThemeFollow.follow)
      // Until the terminal has answered, the stored theme is the last one it
      // was seen in, which beats a guess.
      const bootTheme = (configuredThemeFollow.follow && renderer.themeMode
        ? themeSlotsRef.current[renderer.themeMode]
        : null) ?? configuredTheme
      setThemeMode(bootTheme)
      setActiveTheme(bootTheme)
      // Restore the instance the list was narrowed to, if it is still offered.
      const instanceState = await readTuiProviderInstances().catch(() => ({ selected: null, choices: [] as TuiProviderInstanceChoice[] }))
      if (cancelled) return
      const configuredInstanceId = instanceState.choices.some((choice) => choice.provider === configuredProvider && choice.providerInstanceId === instanceState.selected)
        ? instanceState.selected
        : null
      const bootProvider = workspaceContext.runtime.restoredKeys.has('provider') ? provider : configuredProvider
      const bootInstance = workspaceContext.runtime.restoredKeys.has('providerInstanceId') ? providerInstanceId : configuredInstanceId
      providerInstanceIdRef.current = bootInstance
      setProviderInstanceId(bootInstance)
      setProviderInstances(instanceState.choices)
      setProvider(bootProvider)
      setRailVisible(configuredRailVisible)
      setFocusMode(configuredFocusMode)
      setStickyHeaders(configuredStickyHeaders)
      setLightweightWindows(configuredLightweightWindows)
      setDensity(configuredDensity)
      setDiffLayout(configuredDiffLayout)
      setTranscriptView(configuredTranscriptView)
      setTranscriptWidth(configuredTranscriptWidth)
      setTabsEnabled(configuredTabsEnabled)
      setTabOrientation(configuredTabOrientation)
      setSidebarSort(configuredSidebarSort)
      setHideScratch(configuredHideScratch)
      setSidebarWidthPreference(configuredSidebarWidth)
      setShowToolCalls(configuredShowToolCalls)
      setVelocityScrollEnabled(configuredVelocityScroll)
      if (workspaceContext.runtime.values.get('legacyInitialWorkspace') === true && !workspaceContext.runtime.restoredKeys.has('splitPaneCount')) {
        setSplitPaneCount(configuredSplitPanes)
        setSplitOrientation(configuredSplitOrientation)
        setSplitReaderShare(configuredSplitReaderShare)
      }
      if (!configuredRailVisible || configuredFocusMode) setFocusedPane('messages')
      await refreshSessions(bootProvider, true, true)
    } catch (err) {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Failed to initialize OpenTUI')
      setLoadingSessions(false)
    } finally {
      if (!cancelled) setBootstrapped(true)
    }
  })()

  return () => {
    cancelled = true
  }
}

export type RendererListenersEffectContext = {
  terminalFocusedRef: React.RefObject<boolean | null>
  renderer: CliRenderer
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  notifyTeamEvent: (title: string, body: string) => void
}

export function runRendererListenersEffect(ctx: RendererListenersEffectContext) {
  const {
    terminalFocusedRef, renderer, showNotice, notifyTeamEvent,
  } = ctx
  const onFocus = () => { terminalFocusedRef.current = true }
  const onBlur = () => { terminalFocusedRef.current = false }
  renderer.on('focus', onFocus)
  renderer.on('blur', onBlur)
  const unsubscribe = subscribeInteractiveCoordinatorNotifications(({ session, signal, viewing }) => {
    // Herdr's delivery setting: read at delivery, so a change applies at once.
    const delivery = coordinatorAlertDelivery(getInteractiveCoordinatorNotifications(), viewing, terminalFocusedRef.current)
    if (delivery.notice) showNotice('info', `Teammates · ${signal.title} — ⌃K t in ${session.title}`, 6000)
    if (delivery.desktop) notifyTeamEvent(signal.kind === 'finished' ? 'teammate finished' : 'teammate needs attention', `${signal.title}: ${signal.detail}`.slice(0, 160))
  })
  return () => {
    unsubscribe()
    renderer.off('focus', onFocus)
    renderer.off('blur', onBlur)
  }
}

export type WorktreeTaskSelectionEffectContext = {
  selectedSessionCwdForWorktree: string | null
  setSelectedWorktreeTask: React.Dispatch<React.SetStateAction<WorktreeTask | null>>
  selectedWorktreeTaskCacheRef: React.RefObject<Map<string, WorktreeTask | null>>
}

export function runWorktreeTaskSelectionEffect(ctx: WorktreeTaskSelectionEffectContext) {
  const {
    selectedSessionCwdForWorktree, setSelectedWorktreeTask, selectedWorktreeTaskCacheRef,
  } = ctx
  if (!selectedSessionCwdForWorktree || !selectedSessionCwdForWorktree.includes(WORKTREE_TASK_CWD_SEGMENT)) {
    setSelectedWorktreeTask(null)
    return
  }
  if (selectedWorktreeTaskCacheRef.current.has(selectedSessionCwdForWorktree)) {
    setSelectedWorktreeTask(selectedWorktreeTaskCacheRef.current.get(selectedSessionCwdForWorktree) ?? null)
    return
  }
  let cancelled = false
  void findTuiWorktreeTask(selectedSessionCwdForWorktree)
    .then((task) => {
      selectedWorktreeTaskCacheRef.current.set(selectedSessionCwdForWorktree, task)
      if (!cancelled) setSelectedWorktreeTask(task)
    })
    .catch(() => {
      selectedWorktreeTaskCacheRef.current.set(selectedSessionCwdForWorktree, null)
      if (!cancelled) setSelectedWorktreeTask(null)
    })
  return () => { cancelled = true }
}

export type ExitConfirmOpenEffectContext = {
  currentThemeRef: React.RefObject<TuiThemeMode>
  themeMode: TuiThemeMode
}

export function runExitConfirmOpenEffect(ctx: ExitConfirmOpenEffectContext) {
  const {
    currentThemeRef, themeMode,
  } = ctx
  currentThemeRef.current = themeMode
}
