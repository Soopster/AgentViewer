'use client'
import type { PendingPermission } from '../../lib/permissions'
import { sessionIdentityKey } from '../../lib/sessionIdentity'
import type { SendAttachment, Session } from '../../lib/types'
import { createDefaultWebComposerQueueStore } from '../../lib/webComposerQueue'
import { COMPOSER_DRAFT_STORAGE_PREFIX, SEND_ATTACHMENT_TYPES, COMPOSER_QUEUE_LOCAL_INLINE_LIMIT } from './constants'
import type { ComposerDraft, QueuedWebSend } from './types'

export function attachmentImagePreviewSrc(attachment: SendAttachment): string | null {
  if (attachment.type === 'blob' && attachment.data && attachment.mimeType?.startsWith('image/')) {
    return `data:${attachment.mimeType};base64,${attachment.data}`
  }
  if (attachment.type === 'image') {
    const path = attachment.path ?? attachment.filePath ?? ''
    if (/^https?:\/\//i.test(path)) return path
    if (path.startsWith('data:')) return path
  }
  return null
}
export function attachmentDisplayName(attachment: SendAttachment): string {
  if (attachment.displayName) return attachment.displayName
  const path = attachment.path ?? attachment.filePath ?? attachment.type
  return path.split('/').filter(Boolean).at(-1) ?? path
}
export function permissionDenialReason(permission: PendingPermission): string {
  const target = permission.command
    ? `command "${permission.command}"`
    : permission.url
      ? `URL ${permission.url}`
      : permission.paths && permission.paths.length > 0
        ? `path ${permission.paths.join(', ')}`
        : permission.detail
          ? permission.detail
          : permission.title
  return `User rejected ${target} in Agent Viewer.`
}
export function composerDraftStorageKey(session: Session | null): string | null {
  if (!session) return null
  return `${COMPOSER_DRAFT_STORAGE_PREFIX}${sessionIdentityKey(session)}`
}
function normalizeDraftAttachments(value: unknown): SendAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((attachment) => {
    if (!attachment || typeof attachment !== 'object') return []
    const record = attachment as Partial<SendAttachment>
    if (!record.type || typeof record.type !== 'string' || !SEND_ATTACHMENT_TYPES.has(record.type as SendAttachment['type'])) return []
    return [{
      ...record,
      id: typeof record.id === 'string' ? record.id : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: record.type as SendAttachment['type'],
    } as SendAttachment]
  })
}
export function readComposerDraft(storageKey: string | null): ComposerDraft {
  if (!storageKey || typeof window === 'undefined') return { text: '', attachments: [] }
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return { text: '', attachments: [] }
    const parsed = JSON.parse(raw) as Partial<ComposerDraft>
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      attachments: normalizeDraftAttachments(parsed.attachments),
    }
  } catch {
    return { text: '', attachments: [] }
  }
}
export function writeComposerDraft(storageKey: string | null, draft: ComposerDraft) {
  if (!storageKey || typeof window === 'undefined') return
  try {
    if (!draft.text.trim() && draft.attachments.length === 0) {
      window.localStorage.removeItem(storageKey)
      return
    }
    window.localStorage.setItem(storageKey, JSON.stringify(draft))
  } catch {
    /* localStorage may be unavailable or full */
  }
}
function isQueuedWebSend(value: unknown): value is QueuedWebSend {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<QueuedWebSend>
  if (typeof entry.id !== 'string' || !entry.id) return false
  if (typeof entry.targetKey !== 'string' || !entry.targetKey) return false
  if (typeof entry.text !== 'string' || !Array.isArray(entry.attachments)) return false
  return entry.attachments.every((attachment) => (
    Boolean(attachment)
    && typeof attachment === 'object'
    && typeof attachment.type === 'string'
    && SEND_ATTACHMENT_TYPES.has(attachment.type as SendAttachment['type'])
  ))
}
function shouldInlineComposerQueue(queue: QueuedWebSend[]): boolean {
  let inlineChars = 0
  for (const entry of queue) {
    inlineChars += entry.text.length + entry.id.length + entry.targetKey.length
    for (const attachment of entry.attachments) {
      // Structured extension payloads can be arbitrarily large. Keep those on
      // IndexedDB's asynchronous path instead of serializing them on the input
      // event that queues the follow-up.
      if (attachment.payload) return false
      inlineChars += (attachment.data?.length ?? 0)
        + (attachment.text?.length ?? 0)
        + (attachment.path?.length ?? 0)
        + (attachment.filePath?.length ?? 0)
        + (attachment.displayName?.length ?? 0)
      if (inlineChars > COMPOSER_QUEUE_LOCAL_INLINE_LIMIT) return false
    }
  }
  return true
}
let webComposerQueueStore: ReturnType<typeof createDefaultWebComposerQueueStore<QueuedWebSend>> | null = null
export function getWebComposerQueueStore() {
  webComposerQueueStore ??= createDefaultWebComposerQueueStore(
    isQueuedWebSend,
    shouldInlineComposerQueue,
    (entry) => entry.id
  )
  return webComposerQueueStore
}
