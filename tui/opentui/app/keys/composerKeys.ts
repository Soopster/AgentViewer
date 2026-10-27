/** @jsxImportSource @opentui/react */
import type { KeyEvent } from '@opentui/core'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import type { Timeout } from '@opentui/core'
import type { RefObject } from 'react'
import React from 'react'
import { type TextareaRenderable } from '@opentui/core'
import { type SendState, type Session } from '../../../../lib/types'
import { type RewindCandidate } from '../../rewindTargets'
import { type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { type QueuedComposerSend, type ComposerDraftSnapshot, type TuiMentionResult } from '../types'
import { keepEmpty } from '../collections'

/** Returns true when one of these branches handled the key. */
export function handleComposerKeys({ composerActive, isCtrl, handled, pasteSystemClipboardToComposer, key, composerMention, composerMentionResults, setComposerMentionDismissedStart, setComposerMention, setComposerMentionResults, composerSlashOpen, composerSlashCommands, setComposerSlashDismissed, setComposerSlashIndex, composerHistoryOpen, cancelComposerHistory, composerStashOpen, setComposerStashOpen, setComposerStashIndex, composerRewindItems, setComposerRewindItems, composerSendState, reattachedRunning, rememberComposerCursor, setComposerWindowOpen, setComposerActive, composerWindowOpen, isKeyRepeat, interruptPressActive, cancelComposerSend, setInterruptPressActive, interruptPressTimeoutRef, toggleComposerWindow, activeQueuedComposerSends, clearQueuedComposerSends, popNewestQueuedComposerSend, canUseChannelBridge, routeComposerToBridge, toggleComposerBridgeRoute, searchComposerHistory, editComposerInExternalEditor, pluginOverlay, closePluginOverlay, runPluginCommandId, composerTargetSession, setComposerEnableWorkflow, showToggleOutcome, commitComposerHistory, moveComposerHistory, selectComposerHistoryEntry, sentHistory, sequence, setComposerHistoryOpen, setComposerHistoryIndex, setHistoryIndex, composerRewindIndex, rewindToPrompt, setComposerRewindIndex, commitComposerStashEntry, selectComposerStashEntry, composerStashIndex, composerStash, composerMentionIndex, insertMentionAtCursor, setComposerMentionIndex, composerSlashIndex, insertSlashAtCursor, livePromptSuggestion, composerTextareaRef, setComposerDraft, setLivePromptSuggestion, composerDraft, historyIndex }: {
  composerActive: boolean
  isCtrl: (char: string) => boolean
  handled: (action: () => void) => void
  pasteSystemClipboardToComposer: () => Promise<void>
  key: KeyEvent
  composerMention: { start: number; query: string; } | null
  composerMentionResults: TuiMentionResult[]
  setComposerMentionDismissedStart: React.Dispatch<React.SetStateAction<number | null>>
  setComposerMention: React.Dispatch<React.SetStateAction<{ start: number; query: string; } | null>>
  setComposerMentionResults: React.Dispatch<React.SetStateAction<TuiMentionResult[]>>
  composerSlashOpen: boolean
  composerSlashCommands: SlashCommandSuggestion[]
  setComposerSlashDismissed: React.Dispatch<React.SetStateAction<boolean>>
  setComposerSlashIndex: React.Dispatch<React.SetStateAction<number>>
  composerHistoryOpen: boolean
  cancelComposerHistory: () => void
  composerStashOpen: boolean
  setComposerStashOpen: React.Dispatch<React.SetStateAction<boolean>>
  setComposerStashIndex: React.Dispatch<React.SetStateAction<number>>
  composerRewindItems: RewindCandidate[] | null
  setComposerRewindItems: React.Dispatch<React.SetStateAction<RewindCandidate[] | null>>
  composerSendState: SendState
  reattachedRunning: boolean
  rememberComposerCursor: () => void
  setComposerWindowOpen: React.Dispatch<React.SetStateAction<boolean>>
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  composerWindowOpen: boolean
  isKeyRepeat: boolean
  interruptPressActive: boolean
  cancelComposerSend: () => void
  setInterruptPressActive: React.Dispatch<React.SetStateAction<boolean>>
  interruptPressTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>
  toggleComposerWindow: () => void
  activeQueuedComposerSends: QueuedComposerSend[]
  clearQueuedComposerSends: () => void
  popNewestQueuedComposerSend: () => void
  canUseChannelBridge: boolean
  routeComposerToBridge: boolean
  toggleComposerBridgeRoute: () => void
  searchComposerHistory: () => void
  editComposerInExternalEditor: () => void
  pluginOverlay: 'analytics' | 'file-history' | 'channel-bridge' | 'ide-bridge' | 'coordination' | 'diff' | 'files' | 'editor' | 'messaging' | 'tasks' | 'diagnostics' | 'terminal' | 'browser' | 'subagents' | 'pull-request' | 'checkpoints' | 'teammates' | 'desk' | null
  closePluginOverlay: () => void
  runPluginCommandId: (id: string, session?: Session | null) => void
  composerTargetSession: Session | null
  setComposerEnableWorkflow: React.Dispatch<React.SetStateAction<boolean>>
  showToggleOutcome: (label: string, outcome: string | boolean) => void
  commitComposerHistory: () => void
  moveComposerHistory: (delta: number) => void
  selectComposerHistoryEntry: (displayIndex: number) => void
  sentHistory: ComposerDraftSnapshot[]
  sequence: string
  setComposerHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>
  setComposerHistoryIndex: React.Dispatch<React.SetStateAction<number>>
  setHistoryIndex: React.Dispatch<React.SetStateAction<number>>
  composerRewindIndex: number
  rewindToPrompt: (chosen: RewindCandidate, options?: { restoreFiles?: boolean; }) => Promise<void>
  setComposerRewindIndex: React.Dispatch<React.SetStateAction<number>>
  commitComposerStashEntry: () => void
  selectComposerStashEntry: (displayIndex: number) => void
  composerStashIndex: number
  composerStash: ComposerDraftSnapshot[]
  composerMentionIndex: number
  insertMentionAtCursor: (entry: TuiMentionResult) => void
  setComposerMentionIndex: React.Dispatch<React.SetStateAction<number>>
  composerSlashIndex: number
  insertSlashAtCursor: (command: string) => void
  livePromptSuggestion: string | null
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  setComposerDraft: (action: React.SetStateAction<string>) => void
  setLivePromptSuggestion: React.Dispatch<React.SetStateAction<string | null>>
  composerDraft: string
  historyIndex: number
}): boolean {
    if (composerActive) {
      if (isCtrl('v')) {
        handled(() => { void pasteSystemClipboardToComposer() })
        return true
      }
      if (key.name === 'escape') {
        if (composerMention && composerMentionResults.length > 0) {
          handled(() => {
            setComposerMentionDismissedStart(composerMention.start)
            setComposerMention(null)
            setComposerMentionResults(keepEmpty)
          })
          return true
        }
        if (composerSlashOpen && composerSlashCommands.length > 0) {
          handled(() => {
            setComposerSlashDismissed(true)
            setComposerSlashIndex(0)
          })
          return true
        }
        if (composerHistoryOpen) {
          handled(cancelComposerHistory)
          return true
        }
        if (composerStashOpen) {
          handled(() => {
            setComposerStashOpen(false)
            setComposerStashIndex(0)
          })
          return true
        }
        if (composerRewindItems) {
          handled(() => setComposerRewindItems(null))
          return true
        }
        handled(() => {
          // While a turn is running (owned stream or reattached), Esc hides the
          // composer so the user can read the transcript without cancelling.
          // Use Ctrl+C to interrupt.
          if (composerSendState === 'sending' || reattachedRunning) {
            rememberComposerCursor()
            setComposerWindowOpen(false)
            setComposerActive(false)
            return
          }
          if (composerWindowOpen) {
            rememberComposerCursor()
            setComposerWindowOpen(false)
          } else {
            setComposerActive(false)
          }
        })
        return true
      }
      // Cancel in-flight send (Ctrl+C when composer is open) — requires two
      // presses within 5 s to prevent accidental interrupts. Also covers
      // reattached turns, where the interrupt is fired without a local stream.
      if (isCtrl('c') && (composerSendState === 'sending' || reattachedRunning)) {
        if (isKeyRepeat) {
          key.preventDefault()
          key.stopPropagation()
          return true
        }
        handled(() => {
          if (interruptPressActive) {
            // Stay in the composer, as the native CLIs do: an interrupt is
            // almost always followed by a corrected prompt, and the restored
            // queue (if any) lands back in this draft.
            cancelComposerSend()
          } else {
            setInterruptPressActive(true)
            if (interruptPressTimeoutRef.current) clearTimeout(interruptPressTimeoutRef.current)
            interruptPressTimeoutRef.current = setTimeout(() => {
              setInterruptPressActive(false)
              interruptPressTimeoutRef.current = null
            }, 5000)
          }
        })
        return true
      }
      if (isCtrl('o')) {
        handled(toggleComposerWindow)
        return true
      }
      // Queue management: ⌃Y pops the newest queued message back into the
      // composer to edit (cancelling that send); ⌃Y with shift clears the queue.
      if (isCtrl('y') && activeQueuedComposerSends.length > 0) {
        handled(() => {
          if (key.shift) clearQueuedComposerSends()
          else popNewestQueuedComposerSend()
        })
        return true
      }
      // Toggle the Channel Bridge composer routing right from the composer —
      // same key as the bridge popover's ^R, so the binding is consistent
      // whether or not the panel is open.
      // ⌃R is the native CLIs' prompt-history search. While the composer is
      // routed to the bridge it still turns that routing off (the hint says so);
      // turning it on is the bridge panel's ⌃R or the palette.
      if (isCtrl('r') && canUseChannelBridge && routeComposerToBridge) {
        handled(toggleComposerBridgeRoute)
        return true
      }
      if (isCtrl('r')) {
        handled(searchComposerHistory)
        return true
      }
      if (isCtrl('g')) {
        handled(editComposerInExternalEditor)
        return true
      }
      if (isCtrl('t')) {
        // Claude Code's ⌃T: the task list.
        handled(() => { if (pluginOverlay === 'tasks') closePluginOverlay(); else runPluginCommandId('tasks-full') })
        return true
      }
      // Opt this turn into the Workflow tool (settings.enableWorkflows) —
      // Claude-only, mirrors the ⌃R bridge toggle right above.
      if (isCtrl('w') && composerTargetSession?.provider === 'claude') {
        handled(() => {
          setComposerEnableWorkflow((current) => {
            const next = !current
            showToggleOutcome('Workflow tool (next send)', next)
            return next
          })
        })
        return true
      }
      if (composerHistoryOpen) {
        if (key.name === 'tab' || key.name === 'return') {
          handled(commitComposerHistory)
          return true
        }
        if (key.name === 'n' && key.ctrl) {
          handled(() => moveComposerHistory(-1))
          return true
        }
        if (key.name === 'p' && key.ctrl) {
          handled(() => moveComposerHistory(1))
          return true
        }
        if (key.name === 'down' || key.name === 'j') {
          handled(() => moveComposerHistory(1))
          return true
        }
        if (key.name === 'up' || key.name === 'k') {
          handled(() => moveComposerHistory(-1))
          return true
        }
        if (key.name === 'g' && !key.shift) {
          handled(() => selectComposerHistoryEntry(0))
          return true
        }
        if (key.name === 'g' && key.shift) {
          handled(() => selectComposerHistoryEntry(sentHistory.length - 1))
          return true
        }
        if (
          (!key.ctrl && !key.meta && sequence.length === 1 && sequence >= ' ')
          || key.name === 'backspace'
          || key.name === 'delete'
        ) {
          setComposerHistoryOpen(false)
          setComposerHistoryIndex(0)
          setHistoryIndex(-1)
          return true
        }
      }
      if (composerRewindItems && composerRewindItems.length > 0) {
        const last = composerRewindItems.length - 1
        if (key.name === 'tab') {
          const chosen = composerRewindItems[composerRewindIndex]
          handled(() => {
            setComposerRewindItems(null)
            if (chosen) void rewindToPrompt(chosen, { restoreFiles: true })
          })
          return true
        }
        if (key.name === 'down' || (key.name === 'n' && key.ctrl)) {
          handled(() => setComposerRewindIndex((index) => Math.min(index + 1, last)))
          return true
        }
        if (key.name === 'up' || (key.name === 'p' && key.ctrl)) {
          handled(() => setComposerRewindIndex((index) => Math.max(index - 1, 0)))
          return true
        }
      }
      if (composerStashOpen) {
        if (key.name === 'tab' || key.name === 'return') {
          handled(commitComposerStashEntry)
          return true
        }
        if (key.name === 'n' && key.ctrl) {
          handled(() => selectComposerStashEntry(composerStashIndex + 1))
          return true
        }
        if (key.name === 'p' && key.ctrl) {
          handled(() => selectComposerStashEntry(composerStashIndex - 1))
          return true
        }
        if (key.name === 'down' || key.name === 'j') {
          handled(() => selectComposerStashEntry(composerStashIndex + 1))
          return true
        }
        if (key.name === 'up' || key.name === 'k') {
          handled(() => selectComposerStashEntry(composerStashIndex - 1))
          return true
        }
        if (key.name === 'g' && !key.shift) {
          handled(() => selectComposerStashEntry(0))
          return true
        }
        if (key.name === 'g' && key.shift) {
          handled(() => selectComposerStashEntry(composerStash.length - 1))
          return true
        }
      }
      if (composerMention && composerMentionResults.length > 0) {
        if (key.name === 'tab' || (key.name === 'return' && key.ctrl)) {
          handled(() => {
            const entry = composerMentionResults[composerMentionIndex] ?? composerMentionResults[0]
            if (entry) insertMentionAtCursor(entry)
          })
          return true
        }
        // Arrows move through the menu, as in the native CLIs; ⌃N/⌃P too.
        if ((key.name === 'n' && key.ctrl) || (key.name === 'down' && !key.ctrl && !key.meta && !key.shift)) {
          handled(() => setComposerMentionIndex((i) => Math.min(i + 1, composerMentionResults.length - 1)))
          return true
        }
        if ((key.name === 'p' && key.ctrl) || (key.name === 'up' && !key.ctrl && !key.meta && !key.shift)) {
          handled(() => setComposerMentionIndex((i) => Math.max(i - 1, 0)))
          return true
        }
      }
      if (composerSlashOpen && composerSlashCommands.length > 0) {
        if (key.name === 'tab') {
          handled(() => {
            const entry = composerSlashCommands[composerSlashIndex] ?? composerSlashCommands[0]
            if (entry) insertSlashAtCursor(entry.command)
          })
          return true
        }
        if ((key.name === 'n' && key.ctrl) || (key.name === 'down' && !key.ctrl && !key.meta && !key.shift)) {
          handled(() => setComposerSlashIndex((i) => Math.min(i + 1, composerSlashCommands.length - 1)))
          return true
        }
        if ((key.name === 'p' && key.ctrl) || (key.name === 'up' && !key.ctrl && !key.meta && !key.shift)) {
          handled(() => setComposerSlashIndex((i) => Math.max(i - 1, 0)))
          return true
        }
      }
      if (key.name === 'tab' && livePromptSuggestion && composerSendState !== 'sending') {
        handled(() => {
          composerTextareaRef.current?.setText(livePromptSuggestion)
          setComposerDraft(livePromptSuggestion)
          setLivePromptSuggestion(null)
        })
        return true
      }
      if (key.name === 'p' && key.ctrl) {
        handled(() => moveComposerHistory(1))
        return true
      }
      // ↑ in an empty prompt recalls earlier prompts, as the native CLIs do.
      // Only when empty: in a draft, ↑ is cursor movement between its lines.
      if (key.name === 'up' && !key.ctrl && !key.meta && !key.shift
        && !(composerTextareaRef.current?.plainText ?? composerDraft)) {
        handled(() => moveComposerHistory(1))
        return true
      }
      if (key.name === 'n' && key.ctrl && historyIndex !== -1) {
        handled(() => moveComposerHistory(-1))
        return true
      }
      return true
    }
  return false
}
