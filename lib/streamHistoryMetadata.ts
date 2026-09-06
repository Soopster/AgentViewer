import type { ThreadedMessage } from './threading'

export type StreamHistoryRow = {
  key: string
  message: ThreadedMessage
  previewBadge?: string
}

export type StreamHistoryMetadata = {
  key: string
  messageId: string
  index: number
  role: ThreadedMessage['role']
  title: string
  detail: string
  meta: string
}

// Produce only the displayed prefix. Slicing a fully normalized multi-MB tool
// result can retain that string's backing storage for the lifetime of the cache.
function previewText(text: string): string {
  let length = Math.min(text.length, 512)
  for (;;) {
    let normalized = text.slice(0, length).replace(/\s+/g, ' ').trimStart()
    if (length === text.length) normalized = normalized.trimEnd()
    // One extra character proves the prefix's trailing space is internal.
    if (normalized.length > 280 || length === text.length) {
      return normalized.slice(0, 280).split('').join('')
    }
    length = Math.min(text.length, length * 2)
  }
}

/** Messages are immutable and stabilized by MessageView across poll deltas.
 * Keep only a small preview per message, allowing old sessions to be collected.
 * Row labels and indices are derived each time because filtering changes them.
 */
export function createStreamHistoryMetadataBuilder(toText: (message: ThreadedMessage) => string) {
  const previews = new WeakMap<ThreadedMessage, { title: string; detail: string; tool?: string }>()
  return (rows: readonly StreamHistoryRow[]): StreamHistoryMetadata[] => rows.map((row, index) => {
    let preview = previews.get(row.message)
    if (!preview) {
      const normalized = previewText(toText(row.message))
      const firstTool = row.message.blocks.find((block) => block.type === 'tool_thread')
      preview = {
        title: normalized.slice(0, 92),
        detail: normalized.length > 92 ? normalized.slice(92, 280).trim() : '',
        tool: firstTool?.type === 'tool_thread' ? firstTool.toolUse.name : undefined,
      }
      previews.set(row.message, preview)
    }
    return {
      key: row.key,
      messageId: row.message.uuid,
      index,
      role: row.message.role,
      title: preview.title || row.previewBadge || `${row.message.role} message`,
      detail: preview.detail,
      meta: preview.tool ?? `Turn ${index + 1} · ${row.message.role}`,
    }
  })
}
