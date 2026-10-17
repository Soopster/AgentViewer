import { basename } from 'node:path'
import type { CodexUserInput } from './codexProtocol'
import {
  appendPortableComposerContext,
  assertComposerAttachmentsSupported,
  planComposerAttachments,
  resolveLocalComposerAttachmentPath,
} from './composerAttachments'
import type { SendAttachment } from './types'

function attachmentPath(attachment: SendAttachment): string | undefined {
  return attachment.path || attachment.filePath
}

function attachmentName(attachment: SendAttachment): string {
  const path = attachmentPath(attachment)
  if (attachment.type === 'agent') {
    const textName = attachment.text?.trim().replace(/^@/, '')
    return attachment.displayName || textName || path || 'agent'
  }
  return attachment.displayName || (path ? basename(path) : attachment.type)
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/**
 * Convert the shared composer payload into Codex app-server input without
 * silently dropping attachment context that has no native UserInput variant.
 * Native images, skills, and path mentions remain structured inputs; portable
 * selection/agent/extension text is appended to the text input.
 */
export function buildCodexComposerInput(
  userMessage: string,
  attachments: SendAttachment[],
  cwd?: string,
): CodexUserInput[] {
  const plan = planComposerAttachments('codex', attachments)
  assertComposerAttachmentsSupported('codex', plan)
  const structured: CodexUserInput[] = []

  for (const attachment of plan.native) {
    const path = attachmentPath(attachment)
    if (attachment.type === 'blob' && attachment.data && attachment.mimeType?.startsWith('image/')) {
      structured.push({ type: 'image', url: `data:${attachment.mimeType};base64,${attachment.data}` })
    } else if (attachment.type === 'image' && path) {
      structured.push(isHttpUrl(path)
        ? { type: 'image', url: path }
        : { type: 'localImage', path: resolveLocalComposerAttachmentPath(path, cwd) })
    } else if (attachment.type === 'skill' && path) {
      structured.push({ type: 'skill', name: attachmentName(attachment), path: resolveLocalComposerAttachmentPath(path, cwd) })
    } else if ((attachment.type === 'file' || attachment.type === 'directory' || attachment.type === 'mention') && path) {
      structured.push({ type: 'mention', name: attachmentName(attachment), path: resolveLocalComposerAttachmentPath(path, cwd) })
    }
  }

  const text = appendPortableComposerContext(userMessage, plan.portableText)
  return [{ type: 'text', text, text_elements: [] }, ...structured]
}
