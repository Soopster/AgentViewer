import { createHash } from 'node:crypto'
import { Lexer } from 'marked'

export type MarkdownBlock = { key: string; content: string; estimatedRows: number; marginBottom: number }
/** Partition only at complete top-level Markdown tokens. Fences, tables,
 * blockquotes and lists remain intact, and reference definitions are shared.
 * Parsing belongs in a worker; the UI receives source blocks and estimates. */
export function buildMarkdownBlocks(content: string, chunkCharacters = 4096): MarkdownBlock[] {
  const tokens = Lexer.lex(content)
  // OpenTUI currently exposes reference definitions in its rendered source.
  // Keep such documents together rather than changing link targets or adding
  // duplicate visible definitions at partition boundaries.
  if (Object.keys(tokens.links).length) return [{
    key: createHash('sha256').update(content).digest('hex'), content,
    estimatedRows: Math.max(1, content.split('\n').length), marginBottom: 0,
  }]
  const blocks: Array<{ raw: string; structured: boolean; lastType: string }> = []
  let raw = ''
  let lastType = ''
  const structured = new Set(['code', 'table', 'blockquote', 'list', 'hr'])
  const flush = () => { if (raw.trim()) blocks.push({ raw, structured: false, lastType }); raw = '' }
  for (const token of tokens) {
    if (structured.has(token.type)) { flush(); blocks.push({ raw: token.raw, structured: true, lastType: token.type }) }
    else {
      if (raw.length >= chunkCharacters && token.type !== 'space') flush()
      raw += token.raw
      if (token.type !== 'space') lastType = token.type
    }
  }
  flush()
  return blocks.map((block, index) => ({
    key: `${index}:${createHash('sha256').update(block.raw).digest('hex')}`,
    content: block.raw,
    estimatedRows: Math.max(1, block.raw.split('\n').length),
    marginBottom: index === blocks.length - 1 || block.lastType === 'heading' ? 0 : 1,
  }))
}
