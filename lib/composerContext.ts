import type { ComposerContextKind, SendAttachment } from './types'

export type ComposerContextRecord = { id: string; kind: ComposerContextKind; label: string; text?: string; path?: string }
export const CONTEXT_CLIPBOARD_TYPE = 'application/x-agent-viewer-context+json'
const KINDS = new Set(['file', 'image', 'terminal', 'diff', 'browser'])
const ID = /^[a-zA-Z0-9_-]{1,160}$/
const REFERENCE = /\[([^\]\n]{1,200})\]\(av-context:\/\/([a-zA-Z0-9_-]{1,160})\)/g
const OPEN = '\n\n<agent_viewer_context version="1">\n'
const CLOSE = '\n</agent_viewer_context>'

export function contextReference(attachment: SendAttachment): string {
  const label = (attachment.displayName || attachment.path?.split(/[\\/]/).pop() || attachment.contextKind || 'Context')
    .replace(/[\[\]\r\n]/g, ' ').slice(0, 200) || 'Context'
  return `[${label}](av-context://${attachment.id})`
}

export function contextReferences(text: string): Array<{ raw: string; id: string; label: string; start: number; end: number }> {
  return Array.from(text.matchAll(REFERENCE), match => ({ raw: match[0], label: match[1], id: match[2], start: match.index!, end: match.index! + match[0].length }))
}

export function createContextAttachment(kind: ComposerContextKind, label: string, text?: string, path?: string): SendAttachment {
  return { id: crypto.randomUUID(), type: 'file', contextKind: kind, displayName: label.slice(0, 200), text: boundedContextText(text), path }
}

function boundedContextText(text?: string): string | undefined {
  return text && text.length > 20000 ? text.slice(0, 19960) + '\n… context truncated …' : text
}

export function referencedComposerAttachments(text: string, attachments: SendAttachment[]): SendAttachment[] {
  const ids = new Set(contextReferences(text).map(ref => ref.id))
  return attachments.filter(a => !a.contextKind || ids.has(a.id!))
}

export function contextRecord(attachment: SendAttachment): ComposerContextRecord | null {
  if (typeof attachment.id !== 'string' || !ID.test(attachment.id) || !attachment.contextKind || !KINDS.has(attachment.contextKind)) return null
  const label = typeof attachment.displayName === 'string' ? attachment.displayName : attachment.contextKind
  return { id: attachment.id, kind: attachment.contextKind, label: label.slice(0, 200),
    text: typeof attachment.text === 'string' ? boundedContextText(attachment.text) : undefined,
    path: typeof (attachment.path || attachment.filePath) === 'string' ? (attachment.path || attachment.filePath)!.slice(0, 4096) : undefined }
}

/** Keep unreferenced records while editing so undo and history can restore a chip. Only send referenced records. */
export function projectComposerContext(text: string, attachments: SendAttachment[]): { text: string; attachments: SendAttachment[] } {
  const refs = contextReferences(text)
  if (!refs.length) return { text, attachments: attachments.filter(a => !a.contextKind) }
  const byId = new Map(attachments.map(a => [a.id, a]))
  const ids = new Set(refs.map(ref => ref.id))
  if (ids.size > 100) throw new Error('A message can contain up to 100 context records.')
  const records: ComposerContextRecord[] = []
  for (const id of ids) {
    const attachment = byId.get(id)
    const record = attachment && contextRecord(attachment)
    if (!record) throw new Error('A context reference is unavailable. Remove it or attach it again before sending.')
    if (record.kind === 'image' && !record.path && !(attachment?.type === 'blob' && typeof attachment.data === 'string' && attachment.data && attachment.mimeType?.startsWith('image/'))) {
      throw new Error('An image reference has no image data. Attach the image again before sending.')
    }
    records.push(record)
  }
  // JSON string escaping prevents captured text from closing the envelope. This
  // readable envelope survives SDK transcript replay without a second message store.
  const nativeAttachments = attachments.filter(a => !a.contextKind || (ids.has(a.id!) && (a.contextKind === 'image' || (a.contextKind === 'file' && (a.path || a.filePath)))))
  // The shared provider boundary accepts 12 native attachments. Fail visibly
  // rather than showing a chip whose file would be silently sliced off there.
  if (nativeAttachments.length > 12) throw new Error('A message can contain up to 12 file or image attachments.')
  return { text: encodeContextText(text, records), attachments: nativeAttachments }
}

export function encodeContextText(text: string, records: ComposerContextRecord[]): string {
  if (!records.length) return text
  const payload = JSON.stringify({ records }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  return text + OPEN + payload + CLOSE
}

export function readComposerContext(text: string): { text: string; records: ComposerContextRecord[] } {
  const start = text.lastIndexOf(OPEN)
  const end = start < 0 ? -1 : text.indexOf(CLOSE, start + OPEN.length)
  if (start < 0 || end < 0) return { text, records: [] }
  try {
    const parsed = JSON.parse(text.slice(start + OPEN.length, end)) as { records?: unknown }
    if (!Array.isArray(parsed.records) || parsed.records.length > 100) return { text, records: [] }
    const records: ComposerContextRecord[] = []
    for (const raw of parsed.records) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !ID.test(raw.id) || !KINDS.has(raw.kind) || typeof raw.label !== 'string') return { text, records: [] }
      const record = contextRecord({ id: raw.id, type: 'file', contextKind: raw.kind, displayName: raw.label, text: raw.text, path: raw.path })
      if (record) records.push(record)
    }
    return { text: text.slice(0, start) + text.slice(end + CLOSE.length), records }
  } catch { return { text, records: [] } }
}

export function restoreContextAttachments(records: ComposerContextRecord[]): SendAttachment[] {
  return records.map(r => ({ id: r.id, type: r.kind === 'image' ? 'image' : 'file', contextKind: r.kind, displayName: r.label, path: r.path, text: r.text }))
}

export function removeContextReference(text: string, id: string): string {
  return text.replace(REFERENCE, (raw, _label, refId) => refId === id ? '' : raw)
}

export function readableContextText(text: string): string {
  const decoded = readComposerContext(text)
  return decoded.text.replace(REFERENCE, (_raw, label) => `[${label}]`) + decoded.records.map(r => `\n\n${r.label}${r.path ? ` (${r.path})` : ''}${r.text ? `\n${r.text}` : ''}`).join('')
}
