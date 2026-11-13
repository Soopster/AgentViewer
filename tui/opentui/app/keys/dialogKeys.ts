/** @jsxImportSource @opentui/react */
import { setCoordinatorQuery } from '../../coordinatorStore'
import type { PluginSurfaceId } from '../../../../lib/plugins/catalog'
import type { KeyEvent } from '@opentui/core'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import React from 'react'
import { type ContextMenuItem } from '../../ContextMenu'
import { type PlaybookSummary, type ProtocolAutonomy } from '../../../../lib/agentProtocol'
import { type ProviderSelection, type Session } from '../../../../lib/types'
import { type RemoteCoordinatorTarget } from '../../../../lib/tui/remoteCoordinator'

/** Returns true when one of these branches handled the key. */
export function handleModalDialogKeys({
  exitConfirmOpen, key, handled, confirmExit, cancelExit, worktreeConfirm, setWorktreeConfirm,
  mergeSelectedWorktreeTask, discardSelectedWorktreeTask, worktreeModalOpen, setWorktreeModalOpen,
  setWorktreeDraft, submitWorktreeTask,
  remoteCoordinatorTarget,
  remoteCoordinatorKeyHandlerRef, teammatesModalOpen, teammatesKeyHandlerRef, searchMode,
  setSearchMode, sessionSearchMode, setSessionSearchMode, setSessionSearchQuery, fileHistoryPath,
  fileHistoryKeyHandlerRef, contextMenu,
  contextMenuKeyHandlerRef, windowSwitcherOpen, windowSwitcherKeyRef, windowBroadcastOpen,
  windowBroadcastKeyRef, windowPickerOpen, windowPickerKeyHandlerRef, pluginOverlay,
  pluginOverlayKeyHandlerRef, folderPickerForNewSession, folderPickerKeyHandlerRef,
}: {
  exitConfirmOpen: boolean
  key: KeyEvent
  handled: (action: () => void) => void
  confirmExit: () => void
  cancelExit: () => void
  worktreeConfirm: 'merge' | 'discard' | null
  setWorktreeConfirm: React.Dispatch<React.SetStateAction<'merge' | 'discard' | null>>
  mergeSelectedWorktreeTask: () => Promise<void>
  discardSelectedWorktreeTask: () => Promise<void>
  worktreeModalOpen: boolean
  setWorktreeModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setWorktreeDraft: React.Dispatch<React.SetStateAction<string>>
  submitWorktreeTask: () => Promise<void>
  remoteCoordinatorTarget: RemoteCoordinatorTarget | null
  remoteCoordinatorKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  teammatesModalOpen: boolean
  teammatesKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  searchMode: boolean
  setSearchMode: React.Dispatch<React.SetStateAction<boolean>>
  sessionSearchMode: boolean
  setSessionSearchMode: React.Dispatch<React.SetStateAction<boolean>>
  setSessionSearchQuery: React.Dispatch<React.SetStateAction<string>>
  fileHistoryPath: string | null
  fileHistoryKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean | void) | null>
  contextMenu: { x: number; y: number; title: string; items: ContextMenuItem[]; } | null
  contextMenuKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  windowSwitcherOpen: boolean
  windowSwitcherKeyRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean) | null>
  windowBroadcastOpen: boolean
  windowBroadcastKeyRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean) | null>
  windowPickerOpen: boolean
  windowPickerKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean) | null>
  pluginOverlay: PluginSurfaceId | null
  pluginOverlayKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean | void) | null>
  folderPickerForNewSession: boolean
  folderPickerKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean | void) | null>
}): boolean {
    if (exitConfirmOpen) {
      if (key.name === 'return' || key.name === 'y') {
        handled(confirmExit)
        return true
      }
      if (key.name === 'escape' || key.name === 'n') {
        handled(cancelExit)
        return true
      }
      handled(() => {})
      return true
    }

    if (worktreeConfirm) {
      if (key.name === 'return' || key.name === 'y') {
        handled(() => {
          const action = worktreeConfirm
          setWorktreeConfirm(null)
          if (action === 'merge') void mergeSelectedWorktreeTask()
          else void discardSelectedWorktreeTask()
        })
        return true
      }
      if (key.name === 'escape' || key.name === 'n') {
        handled(() => setWorktreeConfirm(null))
        return true
      }
      handled(() => {})
      return true
    }

    if (worktreeModalOpen) {
      if (key.name === 'escape') {
        handled(() => {
          setWorktreeModalOpen(false)
          setWorktreeDraft('')
        })
      } else if (key.name === 'return') {
        handled(() => { void submitWorktreeTask() })
      }
      // Other keys fall through to the focused name input.
      return true
    }

    if (remoteCoordinatorTarget) {
      handled(() => { remoteCoordinatorKeyHandlerRef.current?.(key) })
      return true
    }

    if (teammatesModalOpen) {
      handled(() => { teammatesKeyHandlerRef.current?.(key) })
      return true
    }

    if (searchMode) {
      if (key.name === 'escape') {
        handled(() => {
          setSearchMode(false)
        })
      }
      return true
    }

    if (sessionSearchMode) {
      if (key.name === 'escape') {
        handled(() => {
          setSessionSearchMode(false)
          setSessionSearchQuery('')
          // The Coordinator tab's search shares the mode and the keys, and Esc clears it the same way.
          setCoordinatorQuery('')
        })
      }
      return true
    }

    if (fileHistoryPath) {
      handled(() => { fileHistoryKeyHandlerRef.current?.(key) })
      return true
    }

    if (contextMenu) {
      handled(() => { contextMenuKeyHandlerRef.current?.(key) })
      return true
    }

    if (windowSwitcherOpen) {
      if (windowSwitcherKeyRef.current?.(key) !== false) handled(() => {})
      return true
    }
    if (windowBroadcastOpen) {
      if (windowBroadcastKeyRef.current?.(key) !== false) handled(() => {})
      return true
    }
    if (windowPickerOpen) {
      if (windowPickerKeyHandlerRef.current?.(key) !== false) handled(() => {})
      return true
    }

    // A plugin overlay (Git, Analytics) owns the keys while it is up; a key its
    // view declines (returns false) is left unhandled.
    if (pluginOverlay) {
      if (pluginOverlayKeyHandlerRef.current?.(key) !== false) handled(() => {})
      return true
    }

    if (folderPickerForNewSession) {
      if (folderPickerKeyHandlerRef.current?.(key) !== false) handled(() => {})
      return true
    }
  return false
}
