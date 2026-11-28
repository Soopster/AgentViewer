import type { SendAttachment } from '../../../lib/types'
import type { TextareaAction } from '@opentui/core'
import type { ComposerPromptPart, QueuedComposerSend, ComposerDraftSnapshot } from './types'

function isSendAttachmentList(value: unknown): value is SendAttachment[] {
  return Array.isArray(value) && value.every((attachment) => attachment && typeof attachment === 'object'
    && typeof (attachment as Partial<SendAttachment>).id === 'string'
    && typeof (attachment as Partial<SendAttachment>).type === 'string')
}
function isComposerPromptPartList(value: unknown): value is ComposerPromptPart[] {
  return Array.isArray(value) && value.every((part) => {
    if (!part || typeof part !== 'object') return false
    const candidate = part as Partial<ComposerPromptPart>
    if (typeof candidate.id !== 'string' || typeof candidate.marker !== 'string') return false
    if (candidate.kind === 'text') return typeof candidate.text === 'string'
    return candidate.kind === 'attachment'
      && Boolean(candidate.attachment && typeof candidate.attachment === 'object')
  })
}
export function isQueuedComposerSend(value: unknown): value is QueuedComposerSend {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<QueuedComposerSend>
  if (typeof entry.id !== 'string' || !entry.id) return false
  if (typeof entry.targetKey !== 'string' || !entry.targetKey) return false
  if (typeof entry.text !== 'string') return false
  return isSendAttachmentList(entry.attachments) && isComposerPromptPartList(entry.promptParts)
}
export function isComposerDraftSnapshot(value: unknown): value is ComposerDraftSnapshot {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<ComposerDraftSnapshot>
  if (typeof entry.text !== 'string') return false
  if (entry.cursorOffset !== undefined && typeof entry.cursorOffset !== 'number') return false
  return isSendAttachmentList(entry.attachments) && isComposerPromptPartList(entry.promptParts)
}
/**
 * What the root draws from the draft, besides the draft's own text. Typing changes the text on
 * every key but this almost never, and the root re-renders only when it does: each field is
 * something the root lays out or decides with, so a change in any must reach it.
 */
export type ComposerDraftShape = {
  /** Lines the dock must hold: logical lines, or the editor's wrapped lines when more. */
  lines: number
  /** Wrapped line counts at the dock's and the expanded composer's widths. */
  dock: number
  window: number
  /** The first line when it is a slash command (the menu filters on it), else empty. */
  slashLine: string
  shell: boolean
  /** Width of the character count, which sizes the stats row. */
  digits: number
  /** The attachment count label, which a pasted part or mention contributes while its marker is in the text. */
  attachments: string
}
/** Lines the dock holds for a draft: its logical lines, or the editor's wrapped lines when more. */
export function composerDraftLineCount(text: string, virtualLines: number | null): number {
  const logical = composerEntryLineCount(text)
  return text.length > 0 && virtualLines !== null ? Math.max(logical, virtualLines) : logical
}
export function computeComposerDraftShape(text: string, dockWidth: number, windowWidth: number, virtualLines: number | null): ComposerDraftShape {
  const lines = composerDraftLineCount(text, virtualLines)
  let dock = 1
  let window = 1
  if (text.length > 0) {
    dock = 0
    window = 0
    for (const line of text.split('\n')) {
      dock += Math.max(1, Math.ceil(line.length / dockWidth))
      window += Math.max(1, Math.ceil(line.length / windowWidth))
    }
  }
  const newline = text.indexOf('\n')
  const firstLine = newline < 0 ? text : text.slice(0, newline)
  return { lines, dock, window, slashLine: firstLine.startsWith('/') ? firstLine : '', shell: text.startsWith('!'), digits: text.length === 0 ? 0 : String(text.length).length, attachments: '' }
}
export function sameComposerDraftShape(a: ComposerDraftShape | null, b: ComposerDraftShape): boolean {
  return a !== null && a.lines === b.lines && a.dock === b.dock && a.window === b.window && a.slashLine === b.slashLine && a.shell === b.shell && a.digits === b.digits && a.attachments === b.attachments
}
export function detectMentionAtCursor(text: string, cursor: number): { start: number; query: string}  | null {
  if (cursor <= 0) return null
  let i = cursor - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') break
    if (!ch || /\s/.test(ch)) return null
    i -= 1
  }
  if (i < 0 || text[i] !== '@') return null
  if (i > 0 && !/\s/.test(text[i - 1] ?? '')) return null
  const query = text.slice(i + 1, cursor)
  if (query.length > 60) return null
  return { start: i, query }
}
export function activeMentionAttachments(text: string, attachments: SendAttachment[]): SendAttachment[] {
  if (attachments.length === 0) return []
  return attachments.filter((attachment) => (
    attachment.type === 'blob' || attachment.type === 'image'
      ? attachment.text ? text.includes(attachment.text) : true
      : attachment.type === 'agent'
        ? Boolean(attachment.displayName && text.includes(`@${attachment.displayName}`))
        : Boolean(attachment.path && text.includes(`@${attachment.path}`))
  ))
}
export function pasteImageMimeType(mimeType: string | undefined): string | null {
  if (!mimeType) return null
  const normalized = mimeType.split(';', 1)[0]?.trim().toLowerCase()
  return normalized?.startsWith('image/') ? normalized : null
}
export function inferPastedImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6))
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  if (bytes.length >= 12) {
    const riff = String.fromCharCode(...bytes.subarray(0, 4))
    const webp = String.fromCharCode(...bytes.subarray(8, 12))
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp'
  }
  return null
}
export function pastedImageDisplayName(mimeType: string): string {
  const extension = mimeType.split('/')[1]?.replace(/[^a-z0-9.+-]/gi, '') || 'png'
  return `pasted-image.${extension}`
}
export function imageAttachmentCount(attachments: SendAttachment[]): number {
  return attachments.filter((attachment) => (
    (attachment.type === 'blob' && attachment.mimeType?.startsWith('image/')) || attachment.type === 'image'
  )).length
}
export function attachmentCountLabel(attachments: SendAttachment[]): string | null {
  if (attachments.length === 0) return null
  const imageCount = imageAttachmentCount(attachments)
  const otherCount = attachments.length - imageCount
  const parts: string[] = []
  if (imageCount > 0) parts.push(`${imageCount} image${imageCount === 1 ? '' : 's'}`)
  if (otherCount > 0) parts.push(`${otherCount} attachment${otherCount === 1 ? '' : 's'}`)
  return parts.join(' · ')
}
export function composerSnapshotText(snapshot: ComposerDraftSnapshot): string {
  return snapshot.text
}
export function compactComposerEntryText(text: string): string {
  return text.replace(/\s+/g, ' ').trim() || '(empty prompt)'
}
export function composerEntryLineCount(text: string): number {
  return text.length === 0 ? 1 : text.split('\n').length
}
// NOTE: OpenTUI's mergeKeyBindings hashes by `name:ctrl:shift:meta:super` —
// `alt` is NOT part of the key. Listing `{ name: 'return', alt: true, ... }`
// collapses onto the same slot as plain `{ name: 'return', ... }` and silently
// overwrites the submit binding, so Enter ends up bound to newline.
// Option-Enter on macOS is delivered as `meta: true` (see binding below).
export type ComposerKeyBinding = { name: string; action: TextareaAction; shift?: boolean; alt?: boolean; meta?: boolean; ctrl?: boolean }
export const composerKeyBindings: ComposerKeyBinding[] = [
  { name: 'return', action: 'submit' },
  { name: 'return', shift: true, action: 'newline' },
  { name: 'return', meta: true, action: 'newline' },
  { name: 'j', ctrl: true, action: 'newline' },
  { name: 'linefeed', action: 'newline' },
]
