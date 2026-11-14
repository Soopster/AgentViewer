import { useState } from 'react'
import { useComposerSessionState, type ComposerSessions } from '@/lib/composerSessions'
import type { SendAttachment } from '@/lib/types'

export function useComposerAttachments(composerSessions: ComposerSessions, composerOwnerKey: string) {
  const [attachments, setAttachments] = useComposerSessionState<SendAttachment[]>(composerSessions, composerOwnerKey, 'attachments', [])
  const [attachmentType, setAttachmentType] = useState<SendAttachment['type']>('file')
  const [attachmentPath, setAttachmentPath] = useState('')
  const [attachmentPanelOpen, setAttachmentPanelOpen] = useState(false)
  return {
    attachments, setAttachments, attachmentType, setAttachmentType, attachmentPath, setAttachmentPath,
    attachmentPanelOpen, setAttachmentPanelOpen,
  }
}
