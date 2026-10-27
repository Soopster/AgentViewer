/** @jsxImportSource @opentui/react */
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { type RefObject } from 'react'
import { type TextareaRenderable } from '@opentui/core'
import { type SendAttachment } from '../../../../lib/types'
import { type ComposerPromptPart } from '../types'
import { keepEmpty } from '../collections'
import { type MutableRefObject } from 'react'
import { type Timeout } from '@opentui/core'
import { removeComposerQueueItem } from '../../../../lib/composerAttachments'
import { type SendState } from '../../../../lib/types'
import { type QueuedComposerSend } from '../types'

export type ComposerPreferredTargetEffectContext = {
  composerPreferredTargetKey: string | null
  selectedSessionKey: string | null
  composerActive: boolean
  composerPreparingTargetKey: string | null
  newSessionModalOpen: boolean
  worktreeModalOpen: boolean
  setComposerPreferredTargetKey: React.Dispatch<React.SetStateAction<string | null>>
}

export function runComposerPreferredTargetEffect(ctx: ComposerPreferredTargetEffectContext) {
  const {
    composerPreferredTargetKey, selectedSessionKey, composerActive, composerPreparingTargetKey,
    newSessionModalOpen, worktreeModalOpen, setComposerPreferredTargetKey,
  } = ctx
  if (
    composerPreferredTargetKey !== null
    && (
      selectedSessionKey !== composerPreferredTargetKey
      || (
        !composerActive
        && composerPreparingTargetKey !== composerPreferredTargetKey
        && !newSessionModalOpen
        && !worktreeModalOpen
      )
    )
  ) {
    setComposerPreferredTargetKey(null)
  }
}

export type DraftRestoreEffectContext = {
  composerTargetSessionIdentity: string | null
  composerDraftStorageKeyRef: React.RefObject<string | null>
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerDraftRef: React.RefObject<string>
  writeWorkspaceDraft: (key: string, text: string) => void
  writeWorkspaceDraftParts: (key: string, parts: unknown[]) => void
  composerPromptPartsRef: React.RefObject<ComposerPromptPart[]>
  setComposerMentionAttachments: React.Dispatch<React.SetStateAction<SendAttachment[]>>
  readWorkspaceDraft: (key: string) => string
  readWorkspaceDraftParts: (key: string) => unknown[]
  setComposerPromptParts: React.Dispatch<React.SetStateAction<ComposerPromptPart[]>>
  setComposerDraft: (action: React.SetStateAction<string>) => void
  restoreComposerPromptPartExtmarks: (parts: ComposerPromptPart[], text: string) => void
}

export function runDraftRestoreEffect(ctx: DraftRestoreEffectContext) {
  const {
    composerTargetSessionIdentity, composerDraftStorageKeyRef, composerTextareaRef,
    composerDraftRef, writeWorkspaceDraft, writeWorkspaceDraftParts, composerPromptPartsRef,
    setComposerMentionAttachments, readWorkspaceDraft, readWorkspaceDraftParts,
    setComposerPromptParts, setComposerDraft, restoreComposerPromptPartExtmarks,
  } = ctx
  if (!composerTargetSessionIdentity) return
  const key = composerTargetSessionIdentity
  const previousKey = composerDraftStorageKeyRef.current
  if (previousKey && previousKey !== key) {
    const outgoingDraft = composerTextareaRef.current?.plainText ?? composerDraftRef.current
    writeWorkspaceDraft(previousKey, outgoingDraft)
    writeWorkspaceDraftParts(previousKey, composerPromptPartsRef.current)
    // Attachments are not persisted, so clear them rather than leaking them
    // into a different session's composer.
    setComposerMentionAttachments(keepEmpty)
    composerTextareaRef.current?.extmarks.clear()
  }
  composerDraftStorageKeyRef.current = key
  const saved = readWorkspaceDraft(key)
  // The content behind the draft's placeholders, restored with it: text
  // alone brought back "[Pasted ~200 lines]" with nothing behind it.
  const savedParts = (readWorkspaceDraftParts(key) as ComposerPromptPart[])
    .filter((part) => part && typeof part.marker === 'string' && saved.includes(part.marker))
  composerPromptPartsRef.current = savedParts
  setComposerPromptParts((current) => current.length === 0 && savedParts.length === 0 ? current : savedParts)
  if (saved !== composerDraftRef.current) {
    composerDraftRef.current = saved
    setComposerDraft(saved)
    composerTextareaRef.current?.setText(saved)
  }
  if (savedParts.length > 0) restoreComposerPromptPartExtmarks(savedParts, saved)
}

export type QueuedSendDrainEffectContext = {
  activeQueuedComposerSends: QueuedComposerSend[]
  runningRegistryReady: boolean
  composerSendState: SendState
  composerAbortRef: React.MutableRefObject<AbortController | null>
  composerRetryTimerRef: React.MutableRefObject<NodeJS.Timeout | null>
  reattachedRunning: boolean
  composerTargetTurnKnownRunning: boolean
  queuedComposerSendsRef: React.RefObject<QueuedComposerSend[]>
  commitQueuedComposerSends: (next: QueuedComposerSend[]) => void
  sendComposerMessage: (draftOverride?: string, attachmentsOverride?: SendAttachment[], isRetry?: boolean, promptPartsOverride?: ComposerPromptPart[], retryTurnRequestId?: string) => Promise<void>
}

export function runQueuedSendDrainEffect(ctx: QueuedSendDrainEffectContext) {
  const {
    activeQueuedComposerSends, runningRegistryReady, composerSendState, composerAbortRef,
    composerRetryTimerRef, reattachedRunning, composerTargetTurnKnownRunning,
    queuedComposerSendsRef, commitQueuedComposerSends, sendComposerMessage,
  } = ctx
  if (activeQueuedComposerSends.length === 0) return
  if (!runningRegistryReady) return
  if (composerSendState !== 'idle' || composerAbortRef.current || composerRetryTimerRef.current) return
  // A turn we reattached to is still running server-side — flushing now
  // would start a second concurrent turn. The registry poll clears the flag
  // when the turn ends.
  if (reattachedRunning || composerTargetTurnKnownRunning) return
  const next = activeQueuedComposerSends[0]!
  const remaining = removeComposerQueueItem(queuedComposerSendsRef.current, next.id)
  // Persist dequeue before provider I/O so a process crash cannot replay a
  // prompt that may already have reached a tool-capable agent.
  commitQueuedComposerSends(remaining)
  void sendComposerMessage(next.text, next.attachments, false, next.promptParts)
}
