import type { SetStateAction } from 'react'
import type { MutableRefObject } from 'react'
import { useState, useMemo } from 'react'
import { type SendAttachment } from '@/lib/types'
import { useComposerSessionState } from '@/lib/composerSessions'
import { selectComposerQueueTarget } from '@/lib/composerAttachments'
import { type QueuedWebSend, type FailedSend, type RewindPreview, type RollbackPreview } from '../types'

export type UseActiveQueuedSendsGroupContext = {
  queuedSends: QueuedWebSend[]
  composerQueueTargetKey: string | null
  composerSessions: { get<T>(key: string, name: string, initial: T | (() => T)): T; set<T>(key: string, name: string, initial: T | (() => T), action: SetStateAction<T>): void; subscribe(key: string, name: string, listener: () => void): () => void; ref<T>(key: string, name: string, initial: T): MutableRefObject<T>; peekRef<T>(key: string, name: string): MutableRefObject<T> | undefined; same(a: string, b: string): boolean; rekey(from: string, to: string): void; keys(): string[]; }
  composerOwnerKey: string
}

export function useActiveQueuedSendsGroup(ctx: UseActiveQueuedSendsGroupContext) {
  const {
    queuedSends, composerQueueTargetKey, composerSessions, composerOwnerKey,
  } = ctx

  const activeQueuedSends = useMemo(
    () => selectComposerQueueTarget(queuedSends, composerQueueTargetKey),
    [composerQueueTargetKey, queuedSends],
  )
  // Last message delivered INTO the running turn via native steering — shown
  // in the composer status line while the turn is still streaming.
  const [steeredNotice, setSteeredNotice] = useComposerSessionState<string | null>(composerSessions, composerOwnerKey, 'steeredNotice', null)
  const [attachments, setAttachments] = useComposerSessionState<SendAttachment[]>(composerSessions, composerOwnerKey, 'attachments', [])
  const [attachmentType, setAttachmentType] = useState<SendAttachment['type']>('file')
  const [attachmentPath, setAttachmentPath] = useState('')
  const [attachmentPanelOpen, setAttachmentPanelOpen] = useState(false)
  const [failedSend, setFailedSend] = useComposerSessionState<FailedSend | null>(composerSessions, composerOwnerKey, 'failedSend', null)
  const [rewindTargetId, setRewindTargetId] = useState('')
  const [rollbackTurns, setRollbackTurns] = useState(1)
  const [resumeFromMessageId, setResumeFromMessageId] = useState<string | null>(null)
  const [previewingRewind, setPreviewingRewind] = useState(false)
  const [applyingRewind, setApplyingRewind] = useState(false)
  const [rewindPreview, setRewindPreview] = useState<RewindPreview | null>(null)
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview | null>(null)
  const [forking, setForking] = useState(false)
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [preferencesHydrated, setPreferencesHydrated] = useState(false)
  const [showVisualizer, setShowVisualizer] = useState(false)

  return {
    activeQueuedSends, steeredNotice, setSteeredNotice, attachments, setAttachments,
    attachmentType, setAttachmentType, attachmentPath, setAttachmentPath, attachmentPanelOpen,
    setAttachmentPanelOpen, failedSend, setFailedSend, rewindTargetId, setRewindTargetId,
    rollbackTurns, setRollbackTurns, resumeFromMessageId, setResumeFromMessageId, previewingRewind,
    setPreviewingRewind, applyingRewind, setApplyingRewind, rewindPreview, setRewindPreview,
    rollbackPreview, setRollbackPreview, forking, setForking, forkingMessageId,
    setForkingMessageId, showDiagnostics, setShowDiagnostics, preferencesHydrated,
    setPreferencesHydrated, showVisualizer, setShowVisualizer,
  }
}
