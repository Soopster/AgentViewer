/** @jsxImportSource @opentui/react */
import { useRef, useState } from 'react'
import { useDisabledPlugins } from '../../../../lib/plugins/useDisabledPlugins'
import { useToasts } from '../../ToastOverlay'
import { useMenuState } from '../state/menuState'

export type UseLoadingSessionsGroupContext = {
  workspaceCwd: string
}

export function useLoadingSessionsGroup(ctx: UseLoadingSessionsGroupContext) {
  const {
    workspaceCwd,
  } = ctx

  const [loadingSessions, setLoadingSessions] = useState(true)
  const [refreshingSessions, setRefreshingSessions] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toasts = useToasts()
  const {
    focusedPane, setFocusedPane, providerMenuOpen, setProviderMenuOpen, providerMenuIndex,
    setProviderMenuIndex, themeMenuOpen, setThemeMenuOpen, themeMenuIndex, setThemeMenuIndex,
    themeMenuGroup, setThemeMenuGroup, themeMenuQuery, setThemeMenuQuery, transcriptViewMenuOpen,
    setTranscriptViewMenuOpen, transcriptViewMenuIndex, setTranscriptViewMenuIndex,
    commandPaletteOpen, setCommandPaletteOpen, commandPaletteQuery, setCommandPaletteQuery,
    commandPaletteIndex, setCommandPaletteIndex, exitConfirmOpen, setExitConfirmOpen,
    exitCleanupInProgress, setExitCleanupInProgress, folderPickerKeyHandlerRef, editorInitialPath,
    setEditorInitialPath, editorInitialLine, setEditorInitialLine, newSessionModalOpen,
    setNewSessionModalOpen, newSessionProvider, setNewSessionProvider, newSessionCwd,
    setNewSessionCwd, newSessionBusy, setNewSessionBusy, folderPickerForNewSession,
    setFolderPickerForNewSession, newSessionKeyHandlerRef, pluginOverlay, setPluginOverlay,
    pluginOpenRequests, setPluginOpenRequests, pluginManagerOpen, setPluginManagerOpen,
    pluginManagerKeyHandlerRef,
  } = useMenuState({
    workspaceCwd,
  })
  const disabledPlugins = useDisabledPlugins()
  const pluginOverlayKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) | null>(null)
  const [handoffBriefOpen, setHandoffBriefOpen] = useState(false)
  const handoffBriefKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)
  const promptLibraryKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }) => void) | null>(null)
  // The bridge panels are the bridges plugin's; the bridges and routing are the composer's.
  const channelBridgeOpen = pluginOverlay === 'channel-bridge'
  // Global Channel Bridge binding: when on, the main composer's send routes to
  // the live `claude` CLI session instead of the active provider (mirrors the
  // web "route composer through bridge" toggle).
  const [routeComposerToBridge, setRouteComposerToBridge] = useState(false)
  const routeComposerToBridgeRef = useRef(false)
  // IDE bridge — third Claude composer flow (agentViewer hosts a Claude Code IDE
  // endpoint a `claude` CLI connects to; see channels/agentviewer-ide.ts).
  // When on, the main composer pushes its line as an @file mention into the
  // connected `claude` session instead of sending a provider turn.
  const [routeComposerToIde, setRouteComposerToIde] = useState(false)
  const routeComposerToIdeRef = useRef(false)

  return {
    loadingSessions, setLoadingSessions, refreshingSessions, setRefreshingSessions, loadingDetail,
    setLoadingDetail, error, setError, toasts, focusedPane, setFocusedPane, providerMenuOpen,
    setProviderMenuOpen, providerMenuIndex, setProviderMenuIndex, themeMenuOpen, setThemeMenuOpen,
    themeMenuIndex, setThemeMenuIndex, themeMenuGroup, setThemeMenuGroup, themeMenuQuery,
    setThemeMenuQuery, transcriptViewMenuOpen, setTranscriptViewMenuOpen, transcriptViewMenuIndex,
    setTranscriptViewMenuIndex, commandPaletteOpen, setCommandPaletteOpen, commandPaletteQuery,
    setCommandPaletteQuery, commandPaletteIndex, setCommandPaletteIndex, exitConfirmOpen,
    setExitConfirmOpen, exitCleanupInProgress, setExitCleanupInProgress, folderPickerKeyHandlerRef,
    editorInitialPath, setEditorInitialPath, editorInitialLine, setEditorInitialLine,
    newSessionModalOpen, setNewSessionModalOpen, newSessionProvider, setNewSessionProvider,
    newSessionCwd, setNewSessionCwd, newSessionBusy, setNewSessionBusy, folderPickerForNewSession,
    setFolderPickerForNewSession, newSessionKeyHandlerRef, pluginOverlay, setPluginOverlay,
    pluginOpenRequests, setPluginOpenRequests, pluginManagerOpen, setPluginManagerOpen,
    pluginManagerKeyHandlerRef, disabledPlugins, pluginOverlayKeyHandlerRef, handoffBriefOpen,
    setHandoffBriefOpen, handoffBriefKeyHandlerRef, promptLibraryOpen, setPromptLibraryOpen,
    promptLibraryKeyHandlerRef, channelBridgeOpen, routeComposerToBridge, setRouteComposerToBridge,
    routeComposerToBridgeRef, routeComposerToIde, setRouteComposerToIde, routeComposerToIdeRef,
  }
}
