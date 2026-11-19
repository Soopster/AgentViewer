/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { Dispatch } from 'react'
import type { SetStateAction } from 'react'
import React from 'react'
import { flushComposerStashWrites, scheduleWriteComposerStash } from '../../../../lib/tuiComposerState'
import { type TextareaRenderable } from '@opentui/core'
import { useStableEvent } from '../../useStableEvent'
import { type SendAttachment } from '../../../../lib/types'
import { type ComposerPromptPart, type ComposerDraftSnapshot, type ClipboardImage, type TuiMentionResult, type NoticeTone } from '../types'
import { clamp } from '../util'
import { readClipboardImage, readClipboardText } from '../clipboard'
import { keepEmpty } from '../collections'
import { runToggleVoice } from '../actions/interaction'

export type UseToggleVoiceGroupContext = {
  voiceJob: React.RefObject<{ controller: AbortController; stop?: () => void; } | null>
  setVoiceStatus: React.Dispatch<React.SetStateAction<string>>
  setComposerActive: React.Dispatch<React.SetStateAction<boolean>>
  insertComposerTextAtCursor: (textToInsert: string) => void
  pasteFilePathToComposer: (text: string) => Promise<boolean>
  insertCompactPastedText: (text: string, marker: string) => void
  attachComposerImage: (image: ClipboardImage) => void
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  setComposerDraft: (action: React.SetStateAction<string>) => void
  setComposerMentionAttachments: React.Dispatch<React.SetStateAction<SendAttachment[]>>
  setComposerPromptParts: React.Dispatch<React.SetStateAction<ComposerPromptPart[]>>
  setComposerMention: React.Dispatch<React.SetStateAction<{ start: number; query: string; } | null>>
  setComposerMentionResults: React.Dispatch<React.SetStateAction<TuiMentionResult[]>>
  setComposerMentionDismissedStart: React.Dispatch<React.SetStateAction<number | null>>
  setComposerSlashIndex: React.Dispatch<React.SetStateAction<number>>
  setComposerSlashDismissed: React.Dispatch<React.SetStateAction<boolean>>
  setComposerHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>
  setComposerHistoryIndex: React.Dispatch<React.SetStateAction<number>>
  setComposerStashOpen: React.Dispatch<React.SetStateAction<boolean>>
  setComposerStashIndex: React.Dispatch<React.SetStateAction<number>>
  composerDraftStorageKeyRef: React.RefObject<string | null>
  writeWorkspaceDraft: (key: string, text: string) => void
  setComposerStash: React.Dispatch<React.SetStateAction<ComposerDraftSnapshot[]>>
  makeComposerSnapshot: () => ComposerDraftSnapshot
  composerStash: ComposerDraftSnapshot[]
  applyComposerSnapshot: (snapshot: ComposerDraftSnapshot) => void
  composerStashIndex: number
}

export function useToggleVoiceGroup(ctx: UseToggleVoiceGroupContext) {
  const {
    voiceJob, setVoiceStatus, setComposerActive, insertComposerTextAtCursor,
    pasteFilePathToComposer, insertCompactPastedText, attachComposerImage, showNotice,
    composerTextareaRef, setComposerDraft, setComposerMentionAttachments, setComposerPromptParts,
    setComposerMention, setComposerMentionResults, setComposerMentionDismissedStart,
    setComposerSlashIndex, setComposerSlashDismissed, setComposerHistoryOpen,
    setComposerHistoryIndex, setComposerStashOpen, setComposerStashIndex,
    composerDraftStorageKeyRef, writeWorkspaceDraft, setComposerStash, makeComposerSnapshot,
    composerStash, applyComposerSnapshot, composerStashIndex,
  } = ctx

  const toggleVoice = useStableEvent(() => runToggleVoice({
    voiceJob, setVoiceStatus, setComposerActive, insertComposerTextAtCursor,
  }))

  const pasteTextToComposer = useStableEvent(async (textToInsert: string) => {
    const normalizedText = textToInsert.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (!normalizedText) return
    if (await pasteFilePathToComposer(normalizedText)) return
    const pastedContent = normalizedText.trim()
    const lineCount = (pastedContent.match(/\n/g)?.length ?? 0) + 1
    if (pastedContent && (lineCount >= 3 || pastedContent.length > 150)) {
      insertCompactPastedText(pastedContent, `[Pasted ~${lineCount} lines]`)
      return
    }
    insertComposerTextAtCursor(normalizedText)
  })

  const pasteSystemClipboardToComposer = useStableEvent(async () => {
    try {
      const image = await readClipboardImage()
      if (image) {
        attachComposerImage(image)
        return
      }
      const text = await readClipboardText()
      if (!text) {
        showNotice('error', 'Clipboard has no supported image or text')
        return
      }
      await pasteTextToComposer(text)
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Failed to paste from clipboard')
    }
  })

  const clearComposerDraft = useStableEvent(() => {
    composerTextareaRef.current?.setText('')
    composerTextareaRef.current?.extmarks.clear()
    setComposerDraft('')
    setComposerMentionAttachments(keepEmpty)
    setComposerPromptParts(keepEmpty)
    setComposerMention(null)
    setComposerMentionResults(keepEmpty)
    setComposerMentionDismissedStart(null)
    setComposerSlashIndex(0)
    setComposerSlashDismissed(false)
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
    setComposerStashOpen(false)
    setComposerStashIndex(0)
    if (composerDraftStorageKeyRef.current) writeWorkspaceDraft(composerDraftStorageKeyRef.current, '')
  })

  // The stash file is written the way the follow-up queue is: in the
  // originating interaction and flushed immediately, not from an effect. A
  // stash exists to survive leaving, and leaving includes an immediate exit.
  const commitComposerStash = useStableEvent((next: ComposerDraftSnapshot[]) => {
    scheduleWriteComposerStash(next)
    flushComposerStashWrites()
    setComposerStash(next)
  })

  const stashComposerPrompt = useStableEvent(() => {
    const snapshot = makeComposerSnapshot()
    if (!snapshot.text.trim() && snapshot.attachments.length === 0 && snapshot.promptParts.length === 0) {
      showNotice('info', 'Composer is empty')
      return
    }
    commitComposerStash([...composerStash, snapshot])
    clearComposerDraft()
    showNotice('info', 'Stashed composer prompt')
  })

  const popComposerStash = useStableEvent(() => {
    const popped = composerStash[composerStash.length - 1] ?? null
    if (!popped) {
      showNotice('info', 'Composer stash is empty')
      return
    }
    commitComposerStash(composerStash.slice(0, -1))
    setComposerActive(true)
    applyComposerSnapshot(popped)
    showNotice('info', 'Restored composer stash')
  })

  const openComposerStashList = useStableEvent(() => {
    if (composerStash.length === 0) {
      showNotice('info', 'Composer stash is empty')
      return
    }
    setComposerActive(true)
    setComposerMention(null)
    setComposerMentionResults(keepEmpty)
    setComposerHistoryOpen(false)
    setComposerStashOpen(true)
    setComposerStashIndex(0)
  })

  const selectComposerStashEntry = useStableEvent((displayIndex: number) => {
    if (composerStash.length === 0) return
    setComposerStashIndex(clamp(displayIndex, 0, composerStash.length - 1))
  })

  const commitComposerStashEntry = useStableEvent(() => {
    const sourceIndex = composerStash.length - 1 - composerStashIndex
    const entry = composerStash[sourceIndex]
    if (!entry) return
    commitComposerStash(composerStash.filter((_, index) => index !== sourceIndex))
    setComposerStashOpen(false)
    setComposerStashIndex(0)
    applyComposerSnapshot(entry)
    showNotice('info', 'Restored composer stash')
  })

  return {
    toggleVoice, pasteTextToComposer, pasteSystemClipboardToComposer, stashComposerPrompt,
    popComposerStash, openComposerStashList, selectComposerStashEntry, commitComposerStashEntry,
  }
}
