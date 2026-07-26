import { basename, isAbsolute, resolve } from 'node:path'
import type { AgentProvider, SendAttachment } from './types'

export type ComposerAttachmentPlan = {
  native: SendAttachment[]
  portable: SendAttachment[]
  portableText: string
  unsupported: SendAttachment[]
}

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

export function resolveLocalComposerAttachmentPath(value: string, cwd?: string): string {
  return isAbsolute(value) ? value : resolve(cwd ?? process.cwd(), value)
}

function hasLocalImage(attachment: SendAttachment): boolean {
  const path = attachmentPath(attachment)
  return attachment.type === 'image' && Boolean(path && !isHttpUrl(path))
}

function hasImageBlob(attachment: SendAttachment): boolean {
  return attachment.type === 'blob'
    && Boolean(attachment.data)
    && attachment.mimeType?.startsWith('image/') === true
}

function canEncodeNatively(provider: AgentProvider, attachment: SendAttachment): boolean {
  const path = attachmentPath(attachment)
  if (provider === 'claude' || provider === 'pi') {
    return hasLocalImage(attachment) || hasImageBlob(attachment)
  }
  if (provider === 'codex') {
    if (hasImageBlob(attachment)) return true
    if (attachment.type === 'image') return Boolean(path)
    if (attachment.type === 'skill') return Boolean(path)
    return (attachment.type === 'file' || attachment.type === 'directory' || attachment.type === 'mention')
      && Boolean(path)
  }
  if (provider === 'opencode') {
    if (hasImageBlob(attachment)) return true
    if (attachment.type === 'agent') return Boolean(attachment.text?.trim() || attachment.displayName)
    return (attachment.type === 'file' || attachment.type === 'image' || attachment.type === 'mention')
      && Boolean(path)
  }
  if (attachment.type === 'blob') {
    return Boolean(attachment.data && attachment.mimeType)
  }
  if (attachment.type === 'extension_context') {
    return Boolean(attachment.extensionId && attachment.capturedAt && attachment.displayName)
  }
  if (attachment.type === 'selection') {
    return Boolean((attachment.filePath || attachment.path) && attachment.displayName)
  }
  return (attachment.type === 'file'
      || attachment.type === 'image'
      || attachment.type === 'mention'
      || attachment.type === 'directory')
    && Boolean(path && !isHttpUrl(path))
}

function selectionLocation(attachment: SendAttachment): string {
  const path = attachmentPath(attachment)
  const selection = attachment.selection
  if (!selection) return path ?? ''
  const startLine = selection.start.line + 1
  const endLine = selection.end.line + 1
  const range = startLine === endLine ? `:${startLine}` : `:${startLine}-${endLine}`
  return `${path ?? ''}${range}`
}

export function formatPortableComposerAttachment(attachment: SendAttachment): string | null {
  const name = attachmentName(attachment)
  const label = `[${attachment.type}: ${name}]`
  const path = attachment.type === 'selection'
    ? selectionLocation(attachment)
    : attachmentPath(attachment)
  const detail = attachment.text?.trim()
    || (attachment.payload ? JSON.stringify(attachment.payload) : '')
  if (path && detail) return `${label} ${path}\n${detail}`
  if (path) return `${label} ${path}`
  if (detail) return `${label}\n${detail}`
  return null
}

export function planComposerAttachments(
  provider: AgentProvider,
  attachments: SendAttachment[],
): ComposerAttachmentPlan {
  const native: SendAttachment[] = []
  const portable: SendAttachment[] = []
  const portableLines: string[] = []
  const unsupported: SendAttachment[] = []
  for (const attachment of attachments) {
    if (canEncodeNatively(provider, attachment)) {
      native.push(attachment)
      continue
    }
    const fallback = formatPortableComposerAttachment(attachment)
    if (fallback) {
      portable.push(attachment)
      portableLines.push(fallback)
    } else {
      unsupported.push(attachment)
    }
  }
  return {
    native,
    portable,
    portableText: portableLines.join('\n\n'),
    unsupported,
  }
}

export function assertComposerAttachmentsSupported(
  provider: AgentProvider,
  plan: ComposerAttachmentPlan,
): void {
  if (plan.unsupported.length === 0) return
  const labels = plan.unsupported.map((attachment) =>
    `${attachment.type} attachment "${attachmentName(attachment)}"`).join(', ')
  throw new Error(`${provider} cannot represent ${labels} without a supported path or text payload.`)
}

export function appendPortableComposerContext(message: string, portableText: string): string {
  return portableText ? `${message}\n\n${portableText}`.trim() : message
}
