/** @jsxImportSource @opentui/react */
import type { RefObject } from 'react'
import type { SetStateAction } from 'react'
import type { Dispatch } from 'react'
import React, { useRef, useState } from 'react'
import { type TextareaRenderable } from '@opentui/core'
import { useStableEvent } from '../../useStableEvent'
import { type SendAttachment, type Session } from '../../../../lib/types'
import { type ComposerPromptPart, type ClipboardImage, type NoticeTone } from '../types'
import { imageAttachmentCount } from '../composerInput'
import { runPasteFilePathToComposer, runInsertComposerPasteMarker } from '../actions/composer'

export type UseInsertComposerPasteMarkerGroupContext = {
  composerTextareaRef: React.RefObject<TextareaRenderable | null>
  ensureComposerPastePartTypeId: (renderable: TextareaRenderable) => number
  setComposerDraft: (action: React.SetStateAction<string>) => void
  composerDraftStorageKeyRef: React.RefObject<string | null>
  writeWorkspaceDraft: (key: string, text: string) => void
  setComposerHistoryOpen: React.Dispatch<React.SetStateAction<boolean>>
  setComposerHistoryIndex: React.Dispatch<React.SetStateAction<number>>
  composerPromptParts: ComposerPromptPart[]
  setComposerMentionAttachments: React.Dispatch<React.SetStateAction<SendAttachment[]>>
  setComposerPromptParts: React.Dispatch<React.SetStateAction<ComposerPromptPart[]>>
  showNotice: (tone: NoticeTone, text: string, durationMs?: number) => void
  composerDraft: string
  prepareComposerSubmission: (visibleText: string, attachments: SendAttachment[], parts: ComposerPromptPart[]) => { visibleText: string; messageText: string; attachments: SendAttachment[]; promptParts: ({ id: string; kind: 'text'; marker: string; text: string; } | { id: string; kind: 'attachment'; marker: string; attachment: SendAttachment; })[]; }
  composerMentionAttachments: SendAttachment[]
  composerTargetSession: Session | null
  selectedSession: Session | null
}

export function useInsertComposerPasteMarkerGroup(ctx: UseInsertComposerPasteMarkerGroupContext) {
  const {
    composerTextareaRef, ensureComposerPastePartTypeId, setComposerDraft,
    composerDraftStorageKeyRef, writeWorkspaceDraft, setComposerHistoryOpen,
    setComposerHistoryIndex, composerPromptParts, setComposerMentionAttachments,
    setComposerPromptParts, showNotice, composerDraft, prepareComposerSubmission,
    composerMentionAttachments, composerTargetSession, selectedSession,
  } = ctx

  const insertComposerPasteMarker = useStableEvent((marker: string, partId: string) => runInsertComposerPasteMarker({
    composerTextareaRef, ensureComposerPastePartTypeId, setComposerDraft,
    composerDraftStorageKeyRef, writeWorkspaceDraft, setComposerHistoryOpen,
    setComposerHistoryIndex,
  }, marker, partId))

  const attachComposerAttachment = useStableEvent((attachment: SendAttachment, marker: string, noticeText: string) => {
    const id = attachment.id || `paste-${Date.now()}-${composerPromptParts.length}`
    const nextAttachment = { ...attachment, id, text: marker }
    insertComposerPasteMarker(marker, id)
    setComposerMentionAttachments((prev) => [...prev, nextAttachment])
    setComposerPromptParts((prev) => [...prev, {
      id,
      kind: 'attachment',
      marker,
      attachment: nextAttachment,
    }])
    showNotice('info', noticeText)
  })

  const attachComposerImage = useStableEvent((image: ClipboardImage) => {
    const visibleDraft = composerTextareaRef.current?.plainText ?? composerDraft
    const activeAttachments = prepareComposerSubmission(visibleDraft, composerMentionAttachments, composerPromptParts).attachments
    const marker = `[Image ${imageAttachmentCount(activeAttachments) + 1}]`
    attachComposerAttachment({
      id: `paste-${Date.now()}-${composerPromptParts.length}`,
      type: 'blob',
      mimeType: image.mimeType,
      data: image.data,
      displayName: image.displayName,
    }, marker, `Attached ${image.displayName}`)
  })

  const insertCompactPastedText = useStableEvent((text: string, marker: string) => {
    const id = `paste-text-${Date.now()}-${composerPromptParts.length}`
    insertComposerPasteMarker(marker, id)
    setComposerPromptParts((prev) => [...prev, {
      id,
      kind: 'text',
      marker,
      text,
    }])
  })

  const pasteFilePathToComposer = useStableEvent(async (text: string) => runPasteFilePathToComposer({
    composerTargetSession, selectedSession, insertCompactPastedText, composerTextareaRef,
    composerDraft, prepareComposerSubmission, composerMentionAttachments, composerPromptParts,
    attachComposerAttachment,
  }, text))

  const insertComposerTextAtCursor = useStableEvent((textToInsert: string) => {
    const renderable = composerTextareaRef.current
    if (!renderable || !textToInsert) return
    const text = renderable.plainText
    const cursor = renderable.cursorOffset
    const next = `${text.slice(0, cursor)}${textToInsert}${text.slice(cursor)}`
    renderable.setText(next)
    renderable.cursorOffset = cursor + textToInsert.length
    setComposerDraft(next)
    if (composerDraftStorageKeyRef.current) writeWorkspaceDraft(composerDraftStorageKeyRef.current, next)
    setComposerHistoryOpen(false)
    setComposerHistoryIndex(0)
  })

  const [voiceStatus, setVoiceStatus] = useState('')
  const voiceJob = useRef<{ controller: AbortController; stop?: () => void } | null>(null)

  return {
    attachComposerImage, insertCompactPastedText, pasteFilePathToComposer,
    insertComposerTextAtCursor, voiceStatus, setVoiceStatus, voiceJob,
  }
}
