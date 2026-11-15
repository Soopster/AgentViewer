// Rich transcript-card content. A card (ToolUseBlock.pluginCard) may carry
// `blocks` beside its `lines`: the non-interactive subset of the view-block
// vocabulary in modViews.ts (heading, text, progress, code, table) plus the two
// shapes a card needs and a view does not (kv, badge). One decoder and one text
// projection serve both renderers, so a card cannot read differently in the Web
// and the TUI. Everything here is browser-safe and does no I/O.
//
// Blocks arrive from plugin code, from declarative recipes and from agents, so
// they are untrusted: every string is scrubbed of escape sequences, control
// characters and bidi overrides, and every collection is capped.

export type CardTone = 'default' | 'muted' | 'success' | 'warning' | 'error'
export type CardBlock =
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'text'; readonly text: string; readonly tone?: CardTone }
  | { readonly type: 'kv'; readonly rows: readonly (readonly [string, string])[] }
  | { readonly type: 'badge'; readonly text: string; readonly tone?: CardTone }
  | { readonly type: 'progress'; readonly label: string; readonly value: number; readonly max: number }
  | { readonly type: 'code'; readonly text: string; readonly language?: string }
  | { readonly type: 'table'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }

export const CARD_BLOCK_LIMITS = Object.freeze({ blocks: 60, text: 2_000, heading: 120, label: 120, cell: 500, columns: 12, rows: 100, kvRows: 40, code: 20_000, language: 40 })

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g
// Control characters except tab and newline, plus bidi overrides that reorder text on screen.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g

/** A string from untrusted code, safe to draw in a terminal or a page, and at most `max` characters. */
export function scrubCardText(value: unknown, max: number): string {
  return String(value ?? '').replace(ANSI, '').replace(/\r\n?/g, '\n').replace(CONTROL, '').slice(0, max)
}

const TONES = new Set<string>(['default', 'muted', 'success', 'warning', 'error'])
const tone = (value: unknown): { tone?: CardTone } => (typeof value === 'string' && TONES.has(value) && value !== 'default' ? { tone: value as CardTone } : {})

/** Untrusted block data reduced to what both renderers draw. Unknown or malformed blocks are dropped, never repaired. */
export function decodeCardBlocks(value: unknown): CardBlock[] {
  if (!Array.isArray(value)) return []
  const L = CARD_BLOCK_LIMITS
  const out: CardBlock[] = []
  for (const entry of value.slice(0, L.blocks)) {
    const block = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    if (block.type === 'heading' && typeof block.text === 'string' && block.text.trim()) out.push({ type: 'heading', text: scrubCardText(block.text, L.heading) })
    else if (block.type === 'text' && typeof block.text === 'string') out.push({ type: 'text', text: scrubCardText(block.text, L.text), ...tone(block.tone) })
    else if (block.type === 'badge' && typeof block.text === 'string' && block.text.trim()) out.push({ type: 'badge', text: scrubCardText(block.text, L.label), ...tone(block.tone) })
    else if (block.type === 'kv' && Array.isArray(block.rows)) {
      const rows = block.rows.slice(0, L.kvRows).flatMap((row: unknown) => Array.isArray(row) && typeof row[0] === 'string' && row[0].trim() ? [[scrubCardText(row[0], L.label), scrubCardText(row[1], L.cell)] as const] : [])
      if (rows.length) out.push({ type: 'kv', rows })
    }
    else if (block.type === 'progress' && typeof block.label === 'string' && typeof block.value === 'number' && Number.isFinite(block.value) && typeof block.max === 'number' && Number.isFinite(block.max) && block.max > 0) out.push({ type: 'progress', label: scrubCardText(block.label, L.label), value: Math.max(0, Math.min(block.max, block.value)), max: block.max })
    else if (block.type === 'code' && typeof block.text === 'string') out.push({ type: 'code', text: scrubCardText(block.text, L.code), ...(typeof block.language === 'string' && block.language ? { language: scrubCardText(block.language, L.language) } : {}) })
    else if (block.type === 'table' && Array.isArray(block.columns) && block.columns.length && block.columns.every(column => typeof column === 'string') && Array.isArray(block.rows)) {
      const columns = block.columns.slice(0, L.columns).map(column => scrubCardText(column, L.label))
      const rows = block.rows.slice(0, L.rows).filter((row: unknown): row is unknown[] => Array.isArray(row)).map(row => columns.map((_, index) => scrubCardText(row[index], L.cell)))
      out.push({ type: 'table', columns, rows })
    }
  }
  return out
}

/** Plain-text projection: what the TUI draws, and what stands in where blocks cannot. One entry per row. */
export function cardBlockLines(blocks: readonly CardBlock[]): string[] {
  const lines: string[] = []
  for (const block of blocks) {
    if (block.type === 'heading') lines.push(block.text)
    else if (block.type === 'text') lines.push(...block.text.split('\n'))
    else if (block.type === 'badge') lines.push(`[${block.text}]`)
    else if (block.type === 'kv') {
      const width = Math.min(24, Math.max(...block.rows.map(([key]) => key.length)))
      for (const [key, val] of block.rows) lines.push(`${key.padEnd(width)}  ${val}`)
    }
    else if (block.type === 'progress') lines.push(`${block.label} ${Math.round(100 * block.value / block.max)}%`)
    else if (block.type === 'code') lines.push(...block.text.split('\n'))
    else {
      const widths = block.columns.map((column, index) => Math.min(40, Math.max(column.length, ...block.rows.map(row => (row[index] ?? '').length))))
      const cells = (row: readonly string[]) => row.map((cell, index) => cell.slice(0, widths[index]).padEnd(widths[index]!)).join('  ').trimEnd()
      lines.push(cells(block.columns), ...block.rows.map(cells))
    }
  }
  return lines
}
