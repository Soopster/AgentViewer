import { createHash } from 'node:crypto'
import { Lexer, type Tokens } from 'marked'
import { markdownListItems, markdownTableRows, type MarkdownListItem, type MarkdownTableRow } from './markdownStructure'

export type MarkdownBlock = {
  key: string; content: string; estimatedRows: number; marginBottom: number
  code?: { content: string; language: string }
  list?: { markerWidth: number; items: MarkdownListItem[] }
  table?: { rows: MarkdownTableRow[]; widths: number[]; linkedWidths: number[] }
}
/** Partition only at complete top-level Markdown tokens. Fences, tables,
 * blockquotes and lists remain intact, and reference definitions are shared.
 * Parsing belongs in a worker; the UI receives source blocks and estimates. */
export const STRUCTURED_MARKDOWN_ROWS = 2048

export function buildMarkdownBlocks(content: string, chunkCharacters = 4096, structuredRows = STRUCTURED_MARKDOWN_ROWS): MarkdownBlock[] {
  const tokens = Lexer.lex(content)
  // OpenTUI currently exposes reference definitions in its rendered source.
  // Keep such documents together rather than changing link targets or adding
  // duplicate visible definitions at partition boundaries.
  if (Object.keys(tokens.links).length) return [{
    key: createHash('sha256').update(content).digest('hex'), content,
    estimatedRows: Math.max(1, content.split('\n').length), marginBottom: 0,
  }]
  const blocks: Array<{ raw: string; structured: boolean; lastType: string; token?: Tokens.Code | Tokens.List | Tokens.Table }> = []
  let raw = ''
  let lastType = ''
  const structured = new Set(['code', 'table', 'blockquote', 'list', 'hr'])
  const flush = () => { if (raw.trim()) blocks.push({ raw, structured: false, lastType }); raw = '' }
  for (const token of tokens) {
    if (structured.has(token.type)) { flush(); blocks.push({ raw: token.raw, structured: true, lastType: token.type, token: token as Tokens.Code | Tokens.List | Tokens.Table }) }
    else {
      if (raw.length >= chunkCharacters && token.type !== 'space') flush()
      raw += token.raw
      if (token.type !== 'space') lastType = token.type
    }
  }
  flush()
  return blocks.map((block, index) => {
    const key = `${index}:${createHash('sha256').update(block.raw).digest('hex')}`
    const result: MarkdownBlock = {
    key,
    content: block.raw,
    estimatedRows: Math.max(1, block.raw.split('\n').length),
    marginBottom: index === blocks.length - 1 || block.lastType === 'heading' ? 0 : 1,
    }
    if (block.token?.type === 'code' && block.token.text.split('\n').length > structuredRows) result.code = { content: block.token.text, language: block.token.lang ?? '' }
    if (block.token?.type === 'list' && block.token.items.length > structuredRows) result.list = markdownListItems(block.token, key)
    if (block.token?.type === 'table' && block.token.rows.length > structuredRows) {
      const rows = markdownTableRows(block.token, key)
      const widths = block.token.header.map((_, column) => rows.reduce((max, row) => Math.max(max, row.cells[column]!.width), 1))
      const linkedWidths = block.token.header.map((_, column) => rows.reduce((max, row) => Math.max(max, row.cells[column]!.linkedWidth), 1))
      result.table = { rows, widths, linkedWidths }
    }
    return result
  })
}
