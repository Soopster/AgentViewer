/** @jsxImportSource @opentui/react */
import { useRef, useState } from 'react'
import { type PluginSurfaceId } from '../../../../lib/plugins/catalog'
import { useWorkspaceState } from '../../workspaceContext'
import { type AgentProvider, type Session } from '../../../../lib/types'
import { type PaneFocus } from '../types'
import { type ThemeMenuGroup } from '../themes'

export type UseMenuStateContext = {
  workspaceCwd: string
}

export function useMenuState(ctx: UseMenuStateContext) {
  const {
    workspaceCwd,
  } = ctx

  const [focusedPane, setFocusedPane] = useWorkspaceState<PaneFocus>('focusedPane', 'sessions')
  const [providerMenuOpen, setProviderMenuOpen] = useState(false)
  const [providerMenuIndex, setProviderMenuIndex] = useState(0)
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [themeMenuIndex, setThemeMenuIndex] = useState(0)
  const [themeMenuGroup, setThemeMenuGroup] = useState<ThemeMenuGroup>('dark')
  const [themeMenuQuery, setThemeMenuQuery] = useState('')
  const [transcriptViewMenuOpen, setTranscriptViewMenuOpen] = useState(false)
  const [transcriptViewMenuIndex, setTranscriptViewMenuIndex] = useState(0)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0)
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false)
  const [exitCleanupInProgress, setExitCleanupInProgress] = useState(false)
  // The new-session folder picker: the Files plugin's view, asked to choose a directory.
  const folderPickerKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) | null>(null)
  // The file the editor plugin opens on (its target), kept per workspace.
  const [editorInitialPath, setEditorInitialPath] = useWorkspaceState<string | null>('editorInitialPath', null)
  // 1-based, as every transcript reference and stack trace writes it; the editor
  // converts to its own 0-based cursor. Null means "no particular line", which
  // is not the same as line 1 — a file opened with no destination must restore
  // the reader's remembered place instead.
  const [editorInitialLine, setEditorInitialLine] = useWorkspaceState<number | null>('editorInitialLine', null)
  // New agent session modal: pick a folder (via the file picker in folder-select
  // mode) and provider before creating, instead of defaulting to the viewed cwd.
  const [newSessionModalOpen, setNewSessionModalOpen] = useState(false)
  const [newSessionProvider, setNewSessionProvider] = useState<AgentProvider>('claude')
  const [newSessionCwd, setNewSessionCwd] = useWorkspaceState<string>('newSessionCwd', workspaceCwd)
  const [newSessionBusy, setNewSessionBusy] = useState(false)
  const [folderPickerForNewSession, setFolderPickerForNewSession] = useState(false)
  const newSessionKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)
  // The plugin surface open as an overlay, if any (lib/plugins/catalog.ts).
  const [pluginOverlay, setPluginOverlay] = useState<PluginSurfaceId | null>(null)
  // Each plugin surface's open requests: how many, and the session the latest named.
  const [pluginOpenRequests, setPluginOpenRequests] = useState<Partial<Record<PluginSurfaceId, { count: number; session: Session | null }>>>({})
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false)
  const pluginManagerKeyHandlerRef = useRef<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void) | null>(null)

  return {
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
  }
}
