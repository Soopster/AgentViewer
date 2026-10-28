import type { Token, Tokens } from 'marked'
import type { SimpleHighlight } from '@opentui/core'
import { diffTextWidth } from './gitDiffText'

export type MarkdownInlineSpan = { text: string; scope: string; url?: string; fallback?: boolean }
export type MarkdownCell = { spans: MarkdownInlineSpan[]; width: number; linkedWidth: number }
export type MarkdownTableRow = { key: string; cells: MarkdownCell[]; header: boolean; last: boolean }
export type MarkdownListItem = { key: string; marker: string; body: string; marginBottom: number }
export type MarkdownCodeChunk = { key: string; text: string; from: number; to: number; lines: number; styled: boolean; highlights?: SimpleHighlight[] }

/** Plain, serializable inline runs. Mirrors native Markdown's conceal/link
 * semantics without allocating syntax styles or a text buffer for every cell. */
export function markdownInlineSpans(tokens: readonly Token[] = [], styled = 'default', url?: string): MarkdownInlineSpan[] {
  const out: MarkdownInlineSpan[] = []
  const push = (text: string, scope = styled, link = url, fallback = false) => out.push({ text, scope, url: link, fallback })
  for (const token of tokens) {
    switch (token.type) {
      case 'text': case 'escape': push(token.text); break
      case 'codespan': push(token.text, 'markup.raw'); break
      case 'strong': out.push(...markdownInlineSpans(token.tokens, 'markup.strong', url)); break
      case 'em': out.push(...markdownInlineSpans(token.tokens, 'markup.italic', url)); break
      case 'del': out.push(...markdownInlineSpans(token.tokens, 'markup.strikethrough', url)); break
      case 'link': {
        out.push(...markdownInlineSpans(token.tokens, 'markup.link.label', token.href))
        if (token.text !== token.href && token.raw !== token.text && token.raw !== `<${token.text}>`) {
          const supported = new TextEncoder().encode(token.href).byteLength <= 512
          push(' (', 'markup.link', token.href, supported)
          push(token.href, 'markup.link.url', token.href, supported)
          push(')', 'markup.link', token.href, supported)
        }
        break
      }
      case 'image': push(token.text || 'image', 'markup.link.label', url ?? token.href); break
      case 'br': push('\n', 'default'); break
      default:
        if ('tokens' in token && Array.isArray(token.tokens)) out.push(...markdownInlineSpans(token.tokens, 'default', url))
        else if ('text' in token && typeof token.text === 'string') push(token.text, 'default')
    }
  }
  return out
}

export function markdownTableRows(table: Tokens.Table, prefix: string): MarkdownTableRow[] {
  return [table.header, ...table.rows].map((cells, index, rows) => ({
    key: `${prefix}:row:${index}`, header: index === 0, last: index === rows.length - 1,
    cells: table.header.map((_, column) => {
      const spans = markdownInlineSpans(cells[column]?.tokens ?? [])
      if (!spans.length) spans.push({ text: ' ', scope: 'default' })
      const width = (linked: boolean) => Math.max(1, ...spans.filter(span => !linked || !span.fallback).map(span => span.text).join('').split('\n').map(line => diffTextWidth(line, 4)))
      return { spans, width: width(false), linkedWidth: width(true) }
    }),
  }))
}

export function markdownListItems(list: Tokens.List, prefix: string): { markerWidth: number; items: MarkdownListItem[] } {
  const start = Number(list.start) || 1
  const items = list.items.map((item, index) => ({
    key: `${prefix}:item:${index}`, marker: list.ordered ? `${start + index}.` : '-',
    // Coalesced native Markdown keeps the original marker and indentation,
    // including task checkboxes and explicit ordered-list numbering.
    body: item.raw.replace(/\n+$/, ''),
    marginBottom: /\n[ \t]*\n$/.test(item.raw) ? 1 : 0,
  }))
  return { markerWidth: list.ordered ? Math.max(String(start).length, String(start + items.length - 1).length) + 1 : 1, items }
}

/** Line boundaries are source coordinates, independent of the current viewport.
 * Captures are clipped from a whole-code parse, preserving multiline strings,
 * comments, injection ordering and UTF-16 offsets across chunk boundaries. */
export function markdownCodeChunks(content: string, linesPerChunk = 32, highlights?: readonly SimpleHighlight[]): MarkdownCodeChunk[] {
  const chunks: MarkdownCodeChunk[] = []
  let from = 0
  let lineCount = 0
  let firstLine = 0
  const barriers: Array<{ start: number; end: number }> = []
  for (const [start, end, group, meta] of highlights ?? []) {
    if (meta?.conceal === undefined && meta?.concealLines === undefined && !group.startsWith('conceal')) continue
    barriers.push({ start, end: end + (meta?.concealLines !== undefined && content.charCodeAt(end) === 10 ? 1 : 0) })
  }
  barriers.sort((a, b) => a.start - b.start)
  let barrierIndex = 0, barrierEnd = -1
  for (let cursor = 0; cursor <= content.length; cursor++) {
    if (cursor !== content.length && content.charCodeAt(cursor) !== 10) continue
    lineCount++
    if (lineCount < linesPerChunk && cursor !== content.length) continue
    while (barrierIndex < barriers.length && barriers[barrierIndex]!.start < cursor) barrierEnd = Math.max(barrierEnd, barriers[barrierIndex++]!.end)
    // Conceal replacements and omitted newline markers are indivisible, even
    // when they cross the usual chunk boundary.
    if (cursor !== content.length && cursor < barrierEnd) continue
    chunks.push({ key: `line:${firstLine}`, text: content.slice(from, cursor), from, to: cursor, lines: lineCount, styled: Boolean(highlights?.length), highlights: highlights ? [] : undefined })
    from = cursor + 1; firstLine += lineCount; lineCount = 0
  }
  if (highlights) for (const capture of highlights) {
    // Captures arrive in precedence order; do not sort them by source position.
    let low = 0, high = chunks.length
    while (low < high) { const mid = (low + high) >>> 1; if (chunks[mid]!.to <= capture[0]) low = mid + 1; else high = mid }
    for (let index = low; index < chunks.length && chunks[index]!.from < capture[1]; index++) {
      const chunk = chunks[index]!
      const start = Math.max(chunk.from, capture[0]), end = Math.min(chunk.to, capture[1])
      if (start < end) chunk.highlights!.push([start - chunk.from, end - chunk.from, capture[2], capture[3]])
    }
  }
  return chunks
}

/** Match native content-width tables: allocate scarce width by the priority
 * growth²/capacity, with stable left-to-right ties. Work is bounded by the
 * viewport width rather than the number of source rows. */
export function markdownTableWidths(intrinsic: readonly number[], viewportWidth: number): number[] {
  const widths = intrinsic.map(width => Math.max(1, Math.floor(width)))
  const target = Math.max(widths.length, Math.floor(viewportWidth) - widths.length - 1)
  if (widths.reduce((sum, width) => sum + width, 0) <= target) return widths
  const capacity = widths.map(width => width - 1), growth = widths.map(() => 0)
  for (let seat = widths.length; seat < target; seat++) {
    let best = -1
    for (let index = 0; index < widths.length; index++) {
      if (growth[index]! >= capacity[index]!) continue
      if (best < 0 || (growth[index]! + 1) ** 2 * capacity[best]! < (growth[best]! + 1) ** 2 * capacity[index]!) best = index
    }
    if (best < 0) break
    growth[best]++
  }
  return growth.map(value => value + 1)
}
