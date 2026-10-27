/** @jsxImportSource @opentui/react */
import type { MutableRefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import type { RefObject } from 'react'
import type { Timeout } from '@opentui/core'
import { liveMessageSessionKey } from '../../liveTranscriptState'
import React from 'react'
import { toast } from '../../toastStore'
import { type TextareaRenderable } from '@opentui/core'
import { type ThreadedMessage } from '../../../../lib/threading'
import { clearComposerQueueTarget, restoreComposerDraftPayload, selectComposerQueueTarget } from '../../../../lib/composerAttachments'
import { interruptTuiSessionTurn } from '../../../../lib/tui/service'
import { type RunningSessionRef, type SendAttachment, type SendState, type Session } from '../../../../lib/types'
import { type PendingPermission } from '../../../../lib/permissions'
import { join } from 'node:path'
import { type ComposerPromptPart, type QueuedComposerSend, type TuiLiveToolActivity, type SteeredComposerSend } from '../types'
import { sessionKey } from '../sessionList'
import { keepEmpty, keepFiltered } from '../collections'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { type ComposerSubmission } from '../types'
import { imageAttachmentCount } from '../composerInput'
import { normalizePastedFilePath, pastedFileMimeTypeForPath } from '../clipboard'
import { frecencyKey, recordFrecencyUse } from '../../../../lib/tuiFrecency'
import { type TuiMentionResult } from '../types'
import { type ComposerPromptPartRange } from '../types'
import { activeMentionAttachments } from '../composerInput'
import { type ComposerDraftSnapshot } from '../types'
import { type TuiSessionDetail } from '../../../../lib/tui/service'
import { type ProviderComposerConfig } from '../../../../lib/providerComposer'
import { type TuiThemePalette } from '../../../theme'
import { composerProjectLabel } from '../../engineeringLayout'
import { type InlineTextSegment } from '../inlineText'
import { readTuiComposerAffordancesAsync } from '../../sessionDetailWorkerClient'
import { type SlashCommandSuggestion } from '../../../../lib/slashCommands'
import { type readViewSessionComposerOptions } from '../../../../lib/sessionBackend'
import { COMPOSER_AFFORDANCES_CACHE_MAX } from '../timing'
import { touchMapEntry } from '../collections'

export type CancelComposerSendContext = {
  composerTargetSession: Session | null
  activeComposerTurnRequestIdRef: React.MutableRefObject<string | null>
  steeredComposerSendsRef: React.MutableRefObject<SteeredComposerSend[]>
  setLiveTranscriptMessages: React.Dispatch<React.SetStateAction<ThreadedMessage[]>>
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerDraft: string
  setComposerDraft: (action: React.SetStateAction<string>) => void
  composerRetryTimerRef: React.MutableRefObject<NodeJS.Timeout | null>
  composerRetryCountRef: React.MutableRefObject<number>
  liveTranscriptBaselineRef: React.RefObject<Map<string, { count: number; lastFingerprint: string | null; sequenceFingerprint: string; startedAt: number; }>>
  composerInterruptPendingRef: React.MutableRefObject<boolean>
  composerAbortRef: React.MutableRefObject<AbortController | null>
  reattachedRunningKeyRef: React.MutableRefObject<string | null>
  reattachedRunningRef: React.MutableRefObject<boolean>
  setReattachedRunning: React.Dispatch<React.SetStateAction<boolean>>
  reattachMarksRef: React.RefObject<Map<string, RunningSessionRef>>
  clearSessionRunning: (ref: RunningSessionRef) => void
  setInterruptPressActive: React.Dispatch<React.SetStateAction<boolean>>
  interruptPressTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>
  setPendingPermissions: React.Dispatch<React.SetStateAction<PendingPermission[]>>
  setPermissionOptionIndex: React.Dispatch<React.SetStateAction<number>>
  queuedComposerSendsRef: React.RefObject<QueuedComposerSend[]>
  commitQueuedComposerSends: (next: QueuedComposerSend[]) => void
  composerMentionAttachmentsRef: React.RefObject<SendAttachment[]>
  composerPromptPartsRef: React.RefObject<ComposerPromptPart[]>
  setComposerMentionAttachments: React.Dispatch<React.SetStateAction<SendAttachment[]>>
  setComposerPromptParts: React.Dispatch<React.SetStateAction<ComposerPromptPart[]>>
  restoreComposerPromptPartExtmarks: (parts: ComposerPromptPart[], text: string) => void
  setComposerSendState: React.Dispatch<React.SetStateAction<SendState>>
  setAwaitingPersistedTurn: React.Dispatch<React.SetStateAction<boolean>>
  setLiveStatus: React.Dispatch<React.SetStateAction<'requesting' | 'compacting' | 'retrying' | null>>
  setComposerLiveText: React.Dispatch<React.SetStateAction<string>>
  setComposerLiveReasoning: React.Dispatch<React.SetStateAction<string>>
  setComposerThinkingTokens: React.Dispatch<React.SetStateAction<number>>
  pendingLiveReasoningRef: React.MutableRefObject<string>
  liveToolIndexesRef: React.MutableRefObject<Map<number, string>>
  liveToolInputJsonRef: React.MutableRefObject<Map<number, string>>
  liveTextFlushTimerRef: React.MutableRefObject<NodeJS.Timeout | null>
  pendingLiveTextRef: React.MutableRefObject<string>
  liveTextTargetSessionRef: React.MutableRefObject<Session | null>
  setLiveSubagentText: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setLiveToolActivities: React.Dispatch<React.SetStateAction<TuiLiveToolActivity[]>>
}

export function cancelComposerSend(ctx: CancelComposerSendContext) {
  const {
    composerTargetSession, activeComposerTurnRequestIdRef, steeredComposerSendsRef,
    setLiveTranscriptMessages, composerTextareaRef, composerDraft, setComposerDraft,
    composerRetryTimerRef, composerRetryCountRef, liveTranscriptBaselineRef,
    composerInterruptPendingRef, composerAbortRef, reattachedRunningKeyRef, reattachedRunningRef,
    setReattachedRunning, reattachMarksRef, clearSessionRunning, setInterruptPressActive,
    interruptPressTimeoutRef, setPendingPermissions, setPermissionOptionIndex,
    queuedComposerSendsRef, commitQueuedComposerSends, composerMentionAttachmentsRef,
    composerPromptPartsRef, setComposerMentionAttachments, setComposerPromptParts,
    restoreComposerPromptPartExtmarks, setComposerSendState, setAwaitingPersistedTurn,
    setLiveStatus, setComposerLiveText, setComposerLiveReasoning, setComposerThinkingTokens,
    pendingLiveReasoningRef, liveToolIndexesRef, liveToolInputJsonRef, liveTextFlushTimerRef,
    pendingLiveTextRef, liveTextTargetSessionRef, setLiveSubagentText, setLiveToolActivities,
  } = ctx
  const target = composerTargetSession
  // Turns are decoupled from the client connection (they survive disconnect),
  // so aborting the local fetch alone leaves the agent running on the server —
  // it would finish in the background and reappear on the next poll. Interrupt
  // the server-side turn too, matching the native CLI's Esc/Ctrl+C behavior.
  // A pending session included: its first turn registers under the id the
  // TUI already holds, and an interrupt that lands before registration is
  // held for the matching turn id — skipping it left the turn running.
  const interruptTurnRequestId = activeComposerTurnRequestIdRef.current ?? undefined
  if (target && (!target.isPending || interruptTurnRequestId)) {
    void interruptTuiSessionTurn({
      sessionId: target.sessionId,
      provider: target.provider,
      providerInstanceId: target.providerInstanceId,
      turnRequestId: interruptTurnRequestId,
    }).then((stillQueued) => {
      if (stillQueued) {
        const survivorUuids = new Set(stillQueued)
        const restoreEntries = steeredComposerSendsRef.current
          .filter((entry) => entry.state === 'queued' && !survivorUuids.has(entry.messageUuid))
        const restoreTexts = restoreEntries.map((entry) => entry.text)
        if (restoreTexts.length > 0) {
          const restoredMessageUuids = new Set(restoreEntries.map((entry) => entry.messageUuid))
          const restoredLiveUuids = new Set(restoreEntries.map((entry) => entry.liveMessageUuid))
          steeredComposerSendsRef.current = steeredComposerSendsRef.current
            .filter((entry) => !restoredMessageUuids.has(entry.messageUuid))
          setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => !restoredLiveUuids.has(message.uuid)))
          const currentDraft = composerTextareaRef.current?.plainText ?? composerDraft
          const restored = [currentDraft.trim(), ...restoreTexts].filter(Boolean).join('\n\n')
          composerTextareaRef.current?.setText(restored)
          setComposerDraft(restored)
        }
        if (stillQueued.length > 0) {
          toast.warning(`Interrupted · ${stillQueued.length} queued message${stillQueued.length === 1 ? '' : 's'} will still run`)
        } else if (restoreTexts.length > 0) {
          toast.info(`Interrupted · restored ${restoreTexts.length} cancelled queued message${restoreTexts.length === 1 ? '' : 's'}`)
        }
      }
    }).catch(() => { /* best effort */ })
  }
  // Cancel any pending transient auto-retry so it can't fire after an explicit stop.
  if (composerRetryTimerRef.current) {
    clearTimeout(composerRetryTimerRef.current)
    composerRetryTimerRef.current = null
  }
  composerRetryCountRef.current = 0
  const targetKey = target ? sessionKey(target) : null
  // Confirmed interrupt: if the turn had started (a live baseline exists),
  // keep what the agent produced visible and hand off to the awaitingPersistedTurn
  // 'Syncing…' reconcile so the partial output settles smoothly instead of
  // vanishing and reappearing on the next poll. The send's AbortError handler
  // checks composerInterruptPendingRef to avoid undoing this. The awaiting
  // timeout (AWAITING_PERSISTED_TURN_TIMEOUT_MS) is the escape hatch.
  const reconcileInterrupt = Boolean(targetKey && liveTranscriptBaselineRef.current.has(targetKey))
  composerInterruptPendingRef.current = reconcileInterrupt
  if (composerAbortRef.current) {
    composerAbortRef.current.abort()
  }
  composerAbortRef.current = null
  // Reattached turns have no local stream — the server interrupt above is
  // the whole cancel. Drop the flag and the poll's sidebar mark now; the
  // registry poll reconciles if the interrupt turns out to be a no-op.
  reattachedRunningKeyRef.current = null
  reattachedRunningRef.current = false
  setReattachedRunning(false)
  if (targetKey) {
    const reattachMark = reattachMarksRef.current.get(targetKey)
    if (reattachMark) {
      reattachMarksRef.current.delete(targetKey)
      clearSessionRunning(reattachMark)
    }
  }
  setInterruptPressActive(false)
  if (interruptPressTimeoutRef.current) {
    clearTimeout(interruptPressTimeoutRef.current)
    interruptPressTimeoutRef.current = null
  }
  setPendingPermissions(keepEmpty)
  setPermissionOptionIndex(0)
  // The user interrupted to change course — auto-firing queued follow-ups
  // would be a surprise-send. Pop their text back into the composer instead
  // (after any text typed since), so they can edit and re-send.
  const interruptQueue = selectComposerQueueTarget(queuedComposerSendsRef.current, targetKey)
  if (interruptQueue.length > 0) {
    commitQueuedComposerSends(clearComposerQueueTarget(queuedComposerSendsRef.current, targetKey))
    const currentDraft = composerTextareaRef.current?.plainText ?? composerDraft
    const restoredPayload = restoreComposerDraftPayload(
      { text: currentDraft, attachments: composerMentionAttachmentsRef.current },
      interruptQueue,
    )
    const restored = restoredPayload.text
    const restoredParts = [
      ...interruptQueue.flatMap((entry) => entry.promptParts),
      ...composerPromptPartsRef.current,
    ]
    composerTextareaRef.current?.setText(restored)
    setComposerDraft(restored)
    composerMentionAttachmentsRef.current = restoredPayload.attachments
    composerPromptPartsRef.current = restoredParts
    setComposerMentionAttachments(restoredPayload.attachments)
    setComposerPromptParts(restoredParts)
    restoreComposerPromptPartExtmarks(restoredParts, restored)
  }
  if (reconcileInterrupt) {
    // Keep committed partial cards (liveTranscriptMessages) + baseline for the
    // reconcile, but drop the transient streaming previews right away.
    setComposerSendState('idle')
    setAwaitingPersistedTurn(true)
    setLiveStatus(null)
    setComposerLiveText('')
    setComposerLiveReasoning('')
    setComposerThinkingTokens(0)
    pendingLiveReasoningRef.current = ''
    return
  }
  // Nothing started yet — clear cleanly.
  if (targetKey) {
    liveTranscriptBaselineRef.current.delete(targetKey)
    setLiveTranscriptMessages((prev) => keepFiltered(prev, (message) => liveMessageSessionKey(message) !== targetKey))
  }
  liveToolIndexesRef.current.clear()
  liveToolInputJsonRef.current.clear()
  if (liveTextFlushTimerRef.current != null) {
    clearTimeout(liveTextFlushTimerRef.current)
    liveTextFlushTimerRef.current = null
  }
  pendingLiveTextRef.current = ''
  pendingLiveReasoningRef.current = ''
  liveTextTargetSessionRef.current = null
  setComposerSendState('idle')
  setComposerLiveText('')
  setComposerLiveReasoning('')
  setComposerThinkingTokens(0)
  setLiveStatus(null)
  setLiveSubagentText({})
  setLiveToolActivities(keepEmpty)
}

export type PasteFilePathToComposerContext = {
  composerTargetSession: Session | null
  selectedSession: Session | null
  insertCompactPastedText: (text: string, marker: string) => void
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerDraft: string
  prepareComposerSubmission: (visibleText: string, attachments: SendAttachment[], parts: ComposerPromptPart[]) => ComposerSubmission
  composerMentionAttachments: SendAttachment[]
  composerPromptParts: ComposerPromptPart[]
  attachComposerAttachment: (attachment: SendAttachment, marker: string, noticeText: string) => void
}

export async function runPasteFilePathToComposer(ctx: PasteFilePathToComposerContext, text: string) {
  const {
    composerTargetSession, selectedSession, insertCompactPastedText, composerTextareaRef,
    composerDraft, prepareComposerSubmission, composerMentionAttachments, composerPromptParts,
    attachComposerAttachment,
  } = ctx
  const cwd = composerTargetSession?.cwd ?? selectedSession?.cwd ?? null
  const filePath = normalizePastedFilePath(text, cwd)
  if (!filePath) return false
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return false
  } catch {
    return false
  }
  const mimeType = pastedFileMimeTypeForPath(filePath)
  const filename = basename(filePath)
  if (mimeType === 'image/svg+xml') {
    const content = await readFile(filePath, 'utf8').catch(() => null)
    if (!content) return false
    insertCompactPastedText(content, `[SVG: ${filename || 'image'}]`)
    return true
  }
  if (mimeType.startsWith('image/')) {
    const visibleDraft = composerTextareaRef.current?.plainText ?? composerDraft
    const activeAttachments = prepareComposerSubmission(visibleDraft, composerMentionAttachments, composerPromptParts).attachments
    const marker = `[Image ${imageAttachmentCount(activeAttachments) + 1}]`
    attachComposerAttachment({
      id: `paste-file-${Date.now()}-${composerPromptParts.length}`,
      type: 'image',
      path: filePath,
      displayName: filename,
      mimeType,
    }, marker, `Attached ${filename}`)
    return true
  }
  if (mimeType === 'application/pdf') {
    const visibleDraft = composerTextareaRef.current?.plainText ?? composerDraft
    const activeAttachments = prepareComposerSubmission(visibleDraft, composerMentionAttachments, composerPromptParts).attachments
    const pdfCount = activeAttachments.filter((attachment) => attachment.mimeType === 'application/pdf').length
    const marker = `[PDF ${pdfCount + 1}]`
    attachComposerAttachment({
      id: `paste-file-${Date.now()}-${composerPromptParts.length}`,
      type: 'file',
      path: filePath,
      displayName: filename,
      mimeType,
    }, marker, `Attached ${filename}`)
    return true
  }
  return false
}

export type InsertMentionAtCursorContext = {
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerMention: { start: number; query: string; } | null
  composerMentionCwd: string | null
  setComposerDraft: (action: React.SetStateAction<string>) => void
  setComposerMentionAttachments: React.Dispatch<React.SetStateAction<SendAttachment[]>>
  setComposerMention: React.Dispatch<React.SetStateAction<{ start: number; query: string; } | null>>
  setComposerMentionResults: React.Dispatch<React.SetStateAction<TuiMentionResult[]>>
}

export function runInsertMentionAtCursor(ctx: InsertMentionAtCursorContext, entry: TuiMentionResult) {
  const {
    composerTextareaRef, composerMention, composerMentionCwd, setComposerDraft,
    setComposerMentionAttachments, setComposerMention, setComposerMentionResults,
  } = ctx
  const renderable = composerTextareaRef.current
  if (!renderable || !composerMention) return
  const text = renderable.plainText
  const cursor = renderable.cursorOffset
  const before = text.slice(0, composerMention.start)
  const after = text.slice(cursor)
  const insertion = entry.kind === 'agent'
    ? `@${entry.name} `
    : `@${entry.path} `
  // A file you mention is a file you are working in; the next `@` ranks by it.
  if (entry.kind === 'file' && composerMentionCwd) {
    recordFrecencyUse(frecencyKey(composerMentionCwd, entry.path))
  }
  const next = `${before}${insertion}${after}`
  renderable.setText(next)
  renderable.cursorOffset = before.length + insertion.length
  setComposerDraft(next)
  setComposerMentionAttachments((prev) => {
    if (entry.kind === 'agent') {
      if (prev.some((attachment) => attachment.type === 'agent' && attachment.displayName === entry.name)) return prev
      return [
        ...prev,
        {
          id: `agent-${entry.name}`,
          type: 'agent',
          displayName: entry.name,
          text: `@${entry.name}`,
        },
      ]
    }
    if (prev.some((attachment) => attachment.path === entry.path)) return prev
    return [
      ...prev,
      {
        id: `mention-${entry.path}`,
        type: 'mention',
        path: entry.path,
        displayName: entry.basename,
      },
    ]
  })
  setComposerMention(null)
  setComposerMentionResults(keepEmpty)
}

export type PrepareComposerSubmissionContext = {
  activeComposerPromptPartRanges: (text: string, parts: ComposerPromptPart[]) => ComposerPromptPartRange[]
}

export function runPrepareComposerSubmission(ctx: PrepareComposerSubmissionContext, visibleText: string, attachments: SendAttachment[], parts: ComposerPromptPart[]) {
  const {
    activeComposerPromptPartRanges,
  } = ctx
  // The ordinary typing path has no pasted prompt parts or attachments. Do
  // not walk extmarks, build maps, or sort ranges until the composer actually
  // contains one of those richer inputs.
  if (attachments.length === 0 && parts.length === 0) {
    return {
      visibleText,
      messageText: visibleText.trim(),
      attachments: [],
      promptParts: [],
    }
  }
  const promptPartRanges = activeComposerPromptPartRanges(visibleText, parts)
  let messageText = visibleText
  for (const part of [...promptPartRanges].sort((a, b) => b.start - a.start)) {
    if (part.kind !== 'text') continue
    messageText = `${messageText.slice(0, part.start)}${part.text}${messageText.slice(part.end)}`
  }
  const promptPartAttachments = promptPartRanges
    .filter((part): part is ComposerPromptPartRange & { kind: 'attachment' } => part.kind === 'attachment')
    .map((part) => ({ ...part.attachment, text: part.marker }))
  const promptAttachmentIds = new Set(promptPartAttachments.map((attachment) => attachment.id).filter(Boolean))
  const mentionAttachments = activeMentionAttachments(visibleText, attachments)
    .filter((attachment) => !attachment.id || !promptAttachmentIds.has(attachment.id))
  return {
    visibleText,
    messageText: messageText.trim(),
    attachments: [...mentionAttachments, ...promptPartAttachments],
    promptParts: promptPartRanges.map(({ start: _start, end: _end, ...part }) => part),
  }
}

export type ActiveComposerPromptPartRangesContext = {
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  composerPastePartTypeIdRef: React.RefObject<number | null>
}

export function runActiveComposerPromptPartRanges(ctx: ActiveComposerPromptPartRangesContext, text: string, parts: ComposerPromptPart[]) {
  const {
    composerTextareaRef, composerPastePartTypeIdRef,
  } = ctx
  const renderable = composerTextareaRef.current
  const typeId = composerPastePartTypeIdRef.current
  const byId = new Map(parts.map((part) => [part.id, part]))
  if (renderable && typeId != null) {
    return renderable.extmarks
      .getAllForTypeId(typeId)
      .flatMap((extmark: { start: number; end: number; data?: { partId?: unknown } }) => {
        const partId = typeof extmark.data?.partId === 'string' ? extmark.data.partId : ''
        const part = byId.get(partId)
        if (!part) return []
        const marker = text.slice(extmark.start, extmark.end) || part.marker
        return [{ ...part, marker, start: extmark.start, end: extmark.end }]
      })
      .sort((a, b) => a.start - b.start)
  }

  let cursor = 0
  const ranges: ComposerPromptPartRange[] = []
  for (const part of parts) {
    const start = text.indexOf(part.marker, cursor)
    if (start === -1) continue
    const end = start + part.marker.length
    ranges.push({ ...part, start, end })
    cursor = end
  }
  return ranges
}

export type MoveComposerHistoryContext = {
  sentHistory: ComposerDraftSnapshot[]
  composerHistoryOpen: boolean
  historyIndex: number
  openComposerHistory: (displayIndex?: number) => void
  cancelComposerHistory: () => void
  composerHistoryIndex: number
  selectComposerHistoryEntry: (displayIndex: number) => void
}

export function runMoveComposerHistory(ctx: MoveComposerHistoryContext, delta: number) {
  const {
    sentHistory, composerHistoryOpen, historyIndex, openComposerHistory, cancelComposerHistory,
    composerHistoryIndex, selectComposerHistoryEntry,
  } = ctx
  if (sentHistory.length === 0) return
  if (!composerHistoryOpen) {
    if (delta > 0) {
      const currentDisplayIndex = historyIndex === -1
        ? -1
        : sentHistory.length - 1 - historyIndex
      openComposerHistory(Math.max(currentDisplayIndex + 1, 0))
    } else if (historyIndex !== -1) {
      const currentDisplayIndex = sentHistory.length - 1 - historyIndex
      if (currentDisplayIndex <= 0) {
        cancelComposerHistory()
      } else {
        openComposerHistory(currentDisplayIndex - 1)
      }
    }
    return
  }

  const nextDisplayIndex = composerHistoryIndex + delta
  if (nextDisplayIndex < 0) {
    cancelComposerHistory()
    return
  }
  selectComposerHistoryEntry(nextDisplayIndex)
}

export type ReuseLastPromptContext = {
  sessionDetail: TuiSessionDetail | null
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  setComposerDraft: (action: React.SetStateAction<string>) => void
}

export function runReuseLastPrompt(ctx: ReuseLastPromptContext) {
  const {
    sessionDetail, setComposerActive, composerTextareaRef, setComposerDraft,
  } = ctx
  const messages = sessionDetail?.threadedMessages
  if (!messages || messages.length === 0) return
  let lastUserText = ''
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    const text = msg.blocks
      .map((block) => {
        if (block.type === 'text') return block.text ?? ''
        if (block.type === 'local_command_stdout' && 'stdout' in block && typeof block.stdout === 'string') return block.stdout
        return ''
      })
      .join('\n')
      .trim()
    if (text.length > 0) {
      lastUserText = text
      break
    }
  }
  if (!lastUserText) return
  setComposerActive(true)
  composerTextareaRef.current?.setText(lastUserText)
  setComposerDraft(lastUserText)
}

export type RestoreComposerPromptPartExtmarksContext = {
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  ensureComposerPastePartTypeId: (renderable: TextareaRenderable) => number
}

export function runRestoreComposerPromptPartExtmarks(ctx: RestoreComposerPromptPartExtmarksContext, parts: ComposerPromptPart[], text: string) {
  const {
    composerTextareaRef, ensureComposerPastePartTypeId,
  } = ctx
  const renderable = composerTextareaRef.current
  if (!renderable) return
  renderable.extmarks.clear()
  if (parts.length === 0) return
  const typeId = ensureComposerPastePartTypeId(renderable)
  const styleId = renderable.syntaxStyle?.getStyleId('extmark.paste') ?? undefined
  let cursor = 0
  for (const part of parts) {
    const start = text.indexOf(part.marker, cursor)
    if (start === -1) continue
    const end = start + part.marker.length
    renderable.extmarks.create({
      start,
      end,
      virtual: true,
      styleId,
      typeId,
      data: { partId: part.id },
    })
    cursor = end
  }
}

export type InsertComposerPasteMarkerContext = {
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  ensureComposerPastePartTypeId: (renderable: TextareaRenderable) => number
  setComposerDraft: (action: React.SetStateAction<string>) => void
  composerDraftStorageKeyRef: React.RefObject<string | null>
  writeWorkspaceDraft: (key: string, text: string) => void
  setComposerHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>
  setComposerHistoryIndex: React.Dispatch<React.SetStateAction<number>>
}

export function runInsertComposerPasteMarker(ctx: InsertComposerPasteMarkerContext, marker: string, partId: string) {
  const {
    composerTextareaRef, ensureComposerPastePartTypeId, setComposerDraft,
    composerDraftStorageKeyRef, writeWorkspaceDraft, setComposerHistoryOpen,
    setComposerHistoryIndex,
  } = ctx
  const renderable = composerTextareaRef.current
  if (!renderable || !marker || !partId) return
  const textToInsert = `${marker} `
  const start = renderable.cursorOffset
  renderable.insertText(textToInsert)
  const end = start + marker.length
  const typeId = ensureComposerPastePartTypeId(renderable)
  const styleId = renderable.syntaxStyle?.getStyleId('extmark.paste') ?? undefined
  renderable.extmarks.create({
    start,
    end,
    virtual: true,
    styleId,
    typeId,
    data: { partId },
  })
  const next = renderable.plainText
  setComposerDraft(next)
  if (composerDraftStorageKeyRef.current) writeWorkspaceDraft(composerDraftStorageKeyRef.current, next)
  setComposerHistoryOpen(false)
  setComposerHistoryIndex(0)
}

export type BuildComposerStatsSegmentsContext = {
  composerConfig: ProviderComposerConfig
  theme: TuiThemePalette
  composerAccentColor: string
  composerAttachmentLabel: string | null
  composerKnobSegments: InlineTextSegment[]
  composerLocationSegments: InlineTextSegment[]
  composerWorkingDirectory: string | null
}

export function runBuildComposerStatsSegments(ctx: BuildComposerStatsSegmentsContext, lineCount: number, draftLength: number) {
  const {
    composerConfig, theme, composerAccentColor, composerAttachmentLabel, composerKnobSegments,
    composerLocationSegments, composerWorkingDirectory,
  } = ctx
  const segments: InlineTextSegment[] = []
  if (draftLength === 0) {
    segments.push({ text: ` ${composerConfig.label} `, fg: theme.surface, bg: composerAccentColor })
  } else {
    segments.push({ text: `${lineCount} line${lineCount === 1 ? '' : 's'}`, fg: composerAccentColor })
    segments.push({ text: ` · ${draftLength} chars`, fg: theme.text })
  }
  if (composerAttachmentLabel) {
    segments.push({ text: ' · ', fg: theme.dim })
    segments.push({ text: composerAttachmentLabel, fg: theme.cyan })
  }
  if (composerKnobSegments.length > 0) {
    segments.push({ text: ' · ', fg: theme.dim })
    composerKnobSegments.forEach((segment, index) => {
      if (index > 0) segments.push({ text: ' · ', fg: theme.dim })
      segments.push(segment)
    })
  }
  if (composerLocationSegments.length > 0) {
    segments.push({ text: ' · ', fg: theme.dim })
    segments.push(...composerLocationSegments.map((segment) =>
      composerWorkingDirectory && segment.text === `${composerWorkingDirectory}  `
        ? { ...segment, text: `${composerProjectLabel(composerWorkingDirectory)}  ` }
        : segment,
    ))
  }
  return segments
}

export type FetchComposerAffordancesContext = {
  composerAffordancesInFlightRef: React.RefObject<Set<string>>
  composerAffordancesCacheRef: React.RefObject<Map<string, { commands: SlashCommandSuggestion[]; options: Awaited<ReturnType<typeof readViewSessionComposerOptions>>; ts: number; }>>
  committedSessionKeyRef: React.RefObject<string | null>
  applyComposerAffordances: (target: Session, commands: SlashCommandSuggestion[], composerOptions: Awaited<ReturnType<typeof readViewSessionComposerOptions>>) => void
  clearComposerAffordances: () => void
}

export async function runFetchComposerAffordances(ctx: FetchComposerAffordancesContext, target: Session, key: string) {
  const {
    composerAffordancesInFlightRef, composerAffordancesCacheRef, committedSessionKeyRef,
    applyComposerAffordances, clearComposerAffordances,
  } = ctx
  if (composerAffordancesInFlightRef.current.has(key)) return
  composerAffordancesInFlightRef.current.add(key)
  try {
    const { commands: live, options: composerOptions } = await readTuiComposerAffordancesAsync(target)
    const commands = live.map((entry) => ({
      command: entry.command,
      description: entry.description,
      argumentHint: entry.argumentHint && entry.argumentHint.trim() ? entry.argumentHint.trim() : undefined,
    }))
    // Cache even when the session has changed since — the work is done, and
    // the next visit to this session should not spawn again.
    touchMapEntry(composerAffordancesCacheRef.current, key, {
      commands,
      options: composerOptions,
      ts: Date.now(),
    })
    while (composerAffordancesCacheRef.current.size > COMPOSER_AFFORDANCES_CACHE_MAX) {
      const oldest = composerAffordancesCacheRef.current.keys().next().value
      if (oldest === undefined) break
      composerAffordancesCacheRef.current.delete(oldest)
    }
    if (committedSessionKeyRef.current === key) applyComposerAffordances(target, commands, composerOptions)
  } catch {
    if (committedSessionKeyRef.current === key) clearComposerAffordances()
  } finally {
    composerAffordancesInFlightRef.current.delete(key)
  }
}
