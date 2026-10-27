/** @jsxImportSource @opentui/react */
import type { KeyEvent } from '@opentui/core'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import React from 'react'
import { type ContextMenuItem } from '../../ContextMenu'
import { type PlaybookSummary, type ProtocolAutonomy } from '../../../../lib/agentProtocol'
import { type ProviderSelection, type Session } from '../../../../lib/types'
import { type RemoteCoordinatorTarget } from '../../../../lib/tui/remoteCoordinator'
import { moveCoordModalFocus, cycleCoordProvider, coordRunProviders, cycleCoordAutonomy } from '../pickers'

/** Returns true when one of these branches handled the key. */
export function handleModalDialogKeys({ exitConfirmOpen, key, handled, confirmExit, cancelExit, worktreeConfirm, setWorktreeConfirm, mergeSelectedWorktreeTask, discardSelectedWorktreeTask, worktreeModalOpen, setWorktreeModalOpen, setWorktreeDraft, submitWorktreeTask, playbookManagerOpen, playbookManagerKeyHandlerRef, coordModalOpen, setCoordModalOpen, setCoordDraft, setCoordAcceptanceDraft, setCoordNonGoalsDraft, setCoordManualQaDraft, setCoordEscalationDraft, setCoordPlaybookName, setCoordPlaybookArgsDraft, setCoordGateDraft, setCoordMaxTokens, setCoordMaxDurationMinutes, setCoordProviderOverride, setCoordTeammateProviderOverride, setCoordProviderPoolIndex, setCoordModalFocus, setCoordError, isCtrl, setCoordMaxAgents, setCoordRequirePlanApproval, showToggleOutcome, coordModalFocus, coordPlaybooks, coordPlaybookName, selectCoordPlaybook, setPlaybookManagerOpen, provider, selectedSession, coordProviderPoolIndex, coordProviderOverride, setCoordUseWorktrees, setCoordAutonomy, setCoordRequireReview, submitCoordinatedRun, remoteCoordinatorTarget, remoteCoordinatorKeyHandlerRef, teammatesModalOpen, teammatesKeyHandlerRef, searchMode, setSearchMode, sessionSearchMode, setSessionSearchMode, setSessionSearchQuery, fileHistoryPath, fileHistoryKeyHandlerRef, dailySummaryOpen, dailySummaryKeyHandlerRef, contextMenu, contextMenuKeyHandlerRef, windowSwitcherOpen, windowSwitcherKeyRef, windowBroadcastOpen, windowBroadcastKeyRef, windowPickerOpen, windowPickerKeyHandlerRef, pluginOverlay, pluginOverlayKeyHandlerRef, folderPickerForNewSession, folderPickerKeyHandlerRef }: {
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
  playbookManagerOpen: boolean
  playbookManagerKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean) | null>
  coordModalOpen: boolean
  setCoordModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setCoordDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordAcceptanceDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordNonGoalsDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordManualQaDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordEscalationDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordPlaybookName: React.Dispatch<React.SetStateAction<string | null>>
  setCoordPlaybookArgsDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordGateDraft: React.Dispatch<React.SetStateAction<string>>
  setCoordMaxTokens: React.Dispatch<React.SetStateAction<string>>
  setCoordMaxDurationMinutes: React.Dispatch<React.SetStateAction<string>>
  setCoordProviderOverride: React.Dispatch<React.SetStateAction<'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | null>>
  setCoordTeammateProviderOverride: React.Dispatch<React.SetStateAction<('claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp')[] | null>>
  setCoordProviderPoolIndex: React.Dispatch<React.SetStateAction<number>>
  setCoordModalFocus: React.Dispatch<React.SetStateAction<'prompt' | 'acceptance' | 'nonGoals' | 'manualQa' | 'escalation' | 'playbook' | 'playbookArgs' | 'provider' | 'pool' | 'agents' | 'tokenBudget' | 'durationBudget' | 'worktrees' | 'gate' | 'autonomy' | 'plans' | 'review' | 'launch'>>
  setCoordError: React.Dispatch<React.SetStateAction<string | null>>
  isCtrl: (char: string) => boolean
  setCoordMaxAgents: React.Dispatch<React.SetStateAction<number>>
  setCoordRequirePlanApproval: React.Dispatch<React.SetStateAction<boolean>>
  showToggleOutcome: (label: string, outcome: string | boolean) => void
  coordModalFocus: 'prompt' | 'acceptance' | 'nonGoals' | 'manualQa' | 'escalation' | 'playbook' | 'playbookArgs' | 'provider' | 'pool' | 'agents' | 'tokenBudget' | 'durationBudget' | 'worktrees' | 'gate' | 'autonomy' | 'plans' | 'review' | 'launch'
  coordPlaybooks: PlaybookSummary[]
  coordPlaybookName: string | null
  selectCoordPlaybook: (name: string | null, available?: PlaybookSummary[]) => void
  setPlaybookManagerOpen: React.Dispatch<React.SetStateAction<boolean>>
  provider: ProviderSelection
  selectedSession: Session | null
  coordProviderPoolIndex: number
  coordProviderOverride: 'claude' | 'acp' | 'codex' | 'opencode' | 'copilot' | 'pi' | 'lmstudio' | 'claude-acp' | 'codex-acp' | null
  setCoordUseWorktrees: React.Dispatch<React.SetStateAction<boolean>>
  setCoordAutonomy: React.Dispatch<React.SetStateAction<ProtocolAutonomy>>
  setCoordRequireReview: React.Dispatch<React.SetStateAction<boolean>>
  submitCoordinatedRun: () => Promise<void>
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
  dailySummaryOpen: boolean
  dailySummaryKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  contextMenu: { x: number; y: number; title: string; items: ContextMenuItem[]; } | null
  contextMenuKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => void) | null>
  windowSwitcherOpen: boolean
  windowSwitcherKeyRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean) | null>
  windowBroadcastOpen: boolean
  windowBroadcastKeyRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean) | null>
  windowPickerOpen: boolean
  windowPickerKeyHandlerRef: React.RefObject<((key: { name: string; ctrl: boolean; shift: boolean; sequence: string; }) => boolean) | null>
  pluginOverlay: 'browser' | 'terminal' | 'pull-request' | 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'subagents' | 'checkpoints' | 'teammates' | 'desk' | null
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

    if (playbookManagerOpen) {
      if (playbookManagerKeyHandlerRef.current?.(key) !== false) handled(() => {})
      return true
    }

    if (coordModalOpen) {
      if (key.name === 'escape') {
        handled(() => {
          setCoordModalOpen(false)
          setCoordDraft('')
          setCoordAcceptanceDraft('')
          setCoordNonGoalsDraft('')
          setCoordManualQaDraft('')
          setCoordEscalationDraft('')
          setCoordPlaybookName(null)
          setCoordPlaybookArgsDraft('')
          setCoordGateDraft('')
          setCoordMaxTokens('')
          setCoordMaxDurationMinutes('')
          setCoordProviderOverride(null)
          setCoordTeammateProviderOverride(null)
          setCoordProviderPoolIndex(0)
          setCoordModalFocus('prompt')
          setCoordError(null)
        })
      } else if (key.name === 'tab') {
        handled(() => setCoordModalFocus((current) => moveCoordModalFocus(current, key.shift ? -1 : 1)))
      } else if (isCtrl('t')) {
        handled(() => setCoordMaxAgents((current) => (current >= 6 ? 2 : current + 1)))
      } else if (isCtrl('p')) {
        handled(() => setCoordRequirePlanApproval((current) => {
          const next = !current
          showToggleOutcome('Plan approval', next)
          return next
        }))
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'playbook') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => {
          const options = [null, ...coordPlaybooks.map((entry) => entry.name)]
          const index = Math.max(0, options.indexOf(coordPlaybookName))
          selectCoordPlaybook(options[(index + direction + options.length) % options.length] ?? null)
        })
      } else if ((key.name === 'return' || key.name === 'm') && coordModalFocus === 'playbook') {
        handled(() => setPlaybookManagerOpen(true))
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'provider') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => {
          const suggested = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
          setCoordProviderOverride((current) => cycleCoordProvider(current ?? suggested, direction))
        })
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'pool') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => setCoordProviderPoolIndex((current) => (current + direction + coordRunProviders().length) % coordRunProviders().length))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'pool') {
        handled(() => {
          const selectedProvider = coordRunProviders()[coordProviderPoolIndex]!
          const suggested = provider === 'all' ? (selectedSession?.provider ?? 'claude') : provider
          const leadProvider = coordProviderOverride ?? suggested
          setCoordTeammateProviderOverride((current) => {
            const pool = current ?? [leadProvider]
            if (!pool.includes(selectedProvider)) return [...pool, selectedProvider]
            const next = pool.filter((entry) => entry !== selectedProvider)
            return next.length > 0 ? next : [leadProvider]
          })
        })
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'agents') {
        const direction = key.name === 'left' || key.name === 'down' ? -1 : 1
        handled(() => setCoordMaxAgents((current) => Math.min(6, Math.max(2, current + direction))))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'worktrees') {
        handled(() => setCoordUseWorktrees((current) => {
          const next = !current
          showToggleOutcome('Coordinator worktrees', next)
          return next
        }))
      } else if ((key.name === 'left' || key.name === 'right' || key.name === 'up' || key.name === 'down') && coordModalFocus === 'autonomy') {
        const direction = key.name === 'left' || key.name === 'up' ? -1 : 1
        handled(() => setCoordAutonomy((current) => cycleCoordAutonomy(current, direction)))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'plans') {
        handled(() => setCoordRequirePlanApproval((current) => {
          const next = !current
          showToggleOutcome('Plan approval', next)
          return next
        }))
      } else if ((key.name === 'return' || key.name === 'space' || key.sequence === ' ') && coordModalFocus === 'review') {
        handled(() => setCoordRequireReview((current) => {
          const next = !current
          showToggleOutcome('Judgment review', next)
          return next
        }))
      } else if (key.name === 'return' && coordModalFocus === 'launch') {
        handled(() => { void submitCoordinatedRun() })
      } else if (key.name === 'return' && coordModalFocus === 'playbookArgs') {
        handled(() => setCoordModalFocus('provider'))
      } else if (key.name === 'return' && coordModalFocus !== 'prompt') {
        handled(() => setCoordModalFocus((current) => moveCoordModalFocus(current, 1)))
      }
      // Everything else falls through to the focused editor/input.
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
        })
      }
      return true
    }

    if (fileHistoryPath) {
      handled(() => { fileHistoryKeyHandlerRef.current?.(key) })
      return true
    }

    if (dailySummaryOpen) {
      handled(() => { dailySummaryKeyHandlerRef.current?.(key) })
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
