/** @jsxImportSource @opentui/react */
import type { MutableRefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import React, { useMemo, useRef } from 'react'
import { type TuiPluginCapture, type TuiProvidedPluginServices } from '../../shell/pluginTypes'
import { isPluginEnabled } from '../../../../lib/plugins/enablement'
import { getPluginSurface, type PluginSurfaceId } from '../../../../lib/plugins/catalog'
import { type PopoverWindowKind, type SurfaceMeta } from '../../popoverWindows'
import { type ThreadedMessage } from '../../../../lib/threading'
import { type SelectionAskInput } from '../../../../lib/selectionAsk'
import { useStableEvent } from '../../useStableEvent'
import { type Session } from '../../../../lib/types'
import { type NoticeTone } from '../types'
import { type WindowSurfaceId } from '../SplitTranscriptPane'

export type UsePluginSessionForGroupContext = {
  pinnedSessionOf: (surface: WindowSurfaceId) => Session | null
  selectedSession: Session | null
  pluginOpenRequests: Partial<Record<'terminal' | 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk', { count: number; session: Session | null; }>>
  selectedSessionKey: string | null
  liveTranscriptMessagesForSession: ThreadedMessage[]
  pluginServices: TuiProvidedPluginServices
  windowShellSelectionRef: React.MutableRefObject<Map<string, string | null>>
  setFolderPickerForNewSession: React.Dispatch<React.SetStateAction<boolean>>
  handleNewSessionFolderSelected: (path: string) => void
  folderPickerKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean | void) | null>
  surfacePluginKeyCaptureRef: React.RefObject<TuiPluginCapture>
  pluginOverlay: 'terminal' | 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null
  setEditorInitialPath: React.Dispatch<React.SetStateAction<string | null>>
  setEditorInitialLine: React.Dispatch<React.SetStateAction<number | null>>
  setCheckpointFocusPrompt: React.Dispatch<React.SetStateAction<{ sessionId: string; text: string; timestamp?: string; } | null>>
  setPluginOverlay: React.Dispatch<React.SetStateAction<'terminal' | 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  openPopoverWindow: (kind: PopoverWindowKind, pin?: SurfaceMeta, placement?: 'beside' | 'fill' | 'tab') => void
  setFileHistoryPath: React.Dispatch<React.SetStateAction<string | null>>
  fileHistoryKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean | void) | null>
  askAgentAboutSelection: (input: SelectionAskInput) => Promise<void>
}

export function usePluginSessionForGroup(ctx: UsePluginSessionForGroupContext) {
  const {
    pinnedSessionOf, selectedSession, pluginOpenRequests, selectedSessionKey,
    liveTranscriptMessagesForSession, pluginServices, windowShellSelectionRef,
    setFolderPickerForNewSession, handleNewSessionFolderSelected, folderPickerKeyHandlerRef,
    surfacePluginKeyCaptureRef, pluginOverlay, setEditorInitialPath, setEditorInitialLine,
    setCheckpointFocusPrompt, setPluginOverlay, showNotice, openPopoverWindow, setFileHistoryPath,
    fileHistoryKeyHandlerRef, askAgentAboutSelection,
  } = ctx

  // The session a surface shows: a session-pinned window its pin, otherwise the
  // one its latest open named, else the selection.
  const pluginSessionFor = (surfaceId: PluginSurfaceId, slot?: WindowSurfaceId): Session | null => {
    if (getPluginSurface(surfaceId).pin === 'session') return slot ? pinnedSessionOf(slot) : selectedSession
    return pluginOpenRequests[surfaceId]?.session ?? selectedSession
  }
  const pluginLiveTranscript = useMemo(() => ({ key: selectedSessionKey, messages: liveTranscriptMessagesForSession }), [selectedSessionKey, liveTranscriptMessagesForSession])
  // A window's plugin services: the shared ones, plus what that window showed
  // before a remount. Cached per window so a view's services keep their identity.
  const windowPluginServicesRef = useRef(new Map<WindowSurfaceId, { base: TuiProvidedPluginServices; value: TuiProvidedPluginServices }>())
  const windowPluginServices = (slot: WindowSurfaceId): TuiProvidedPluginServices => {
    const cached = windowPluginServicesRef.current.get(slot)
    if (cached?.base === pluginServices) return cached.value
    const value: TuiProvidedPluginServices = {
      ...pluginServices,
      'window-selection': {
        get initial() { return windowShellSelectionRef.current.get(slot) ?? null },
        changed: (id: string | null) => { windowShellSelectionRef.current.set(slot, id) },
      },
    }
    windowPluginServicesRef.current.set(slot, { base: pluginServices, value })
    return value
  }
  const closeFolderPicker = useStableEvent(() => setFolderPickerForNewSession(false))
  const folderPickerServices = useMemo((): TuiProvidedPluginServices => ({
    'directory-picker': { choose: (path: string) => handleNewSessionFolderSelected(path) },
    'scroll-preferences': pluginServices['scroll-preferences'],
  }), [pluginServices, handleNewSessionFolderSelected])
  const registerFolderPickerKeys = useStableEvent((handler: (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) => {
    folderPickerKeyHandlerRef.current = handler
  })
  const surfacePluginCaptureChange = useStableEvent((capture: TuiPluginCapture) => { surfacePluginKeyCaptureRef.current = capture })
  const closePluginOverlay = useStableEvent(() => {
    if (pluginOverlay === 'editor') { setEditorInitialPath(null); setEditorInitialLine(null) }
    if (pluginOverlay === 'checkpoints') setCheckpointFocusPrompt(null)
    setPluginOverlay(null)
  })
  // The file-history plugin, on a file: over the asking view, or as a window beside the layout.
  const openFileHistory = useStableEvent((path: string, where: 'overlay' | 'window' = 'overlay') => {
    if (!isPluginEnabled('file-history')) {
      showNotice('info', 'File history is off · turn it on in Plugins (⌃K palette)')
      return
    }
    if (where === 'window') openPopoverWindow('file-history', { path })
    else setFileHistoryPath(path)
  })
  const closeFileHistory = useStableEvent(() => setFileHistoryPath(null))
  const registerFileHistoryKeys = useStableEvent((handler: (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => boolean | void) => {
    fileHistoryKeyHandlerRef.current = handler
  })
  // Asking about a step leaves for the composer: the checkpoints overlay under
  // it goes too; the editor is left to its own close, which guards unsaved buffers.
  const fileHistoryServices = useMemo((): TuiProvidedPluginServices => ({
    ...pluginServices,
    composer: {
      ...pluginServices.composer!,
      askAboutSelection: (request: SelectionAskInput) => {
        void askAgentAboutSelection(request)
        setPluginOverlay((current) => (current === 'checkpoints' ? null : current))
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pluginServices])
  // Opens the editor on a file (1-based line, or null for its remembered place):
  // in its window when it has one (the open-popover effect routes it), else full screen.
  const openEditorAt = useStableEvent((path: string | null, line: number | null) => {
    if (!isPluginEnabled('editor')) {
      showNotice('info', 'The editor is off · turn it on in Plugins (⌃K palette)')
      return
    }
    setEditorInitialPath(path)
    setEditorInitialLine(line)
    setPluginOverlay('editor')
  })

  return {
    pluginSessionFor, pluginLiveTranscript, windowPluginServices, closeFolderPicker,
    folderPickerServices, registerFolderPickerKeys, surfacePluginCaptureChange, closePluginOverlay,
    openFileHistory, closeFileHistory, registerFileHistoryKeys, fileHistoryServices, openEditorAt,
  }
}
