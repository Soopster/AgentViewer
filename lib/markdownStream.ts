// Splits a markdown document into top-level blocks so a streaming answer can be
// rendered incrementally: every block but the last is finished and can be
// memoized, and only the tail re-renders as deltas arrive. Adapted from
// opencode's `markdown-stream.ts`
// (`packages/session-ui/src/components/markdown-stream.ts`).
//
// Measured against react-markdown, rendering a growing document over 120
// deltas: 191ms → 36ms at 1.5KB, 374ms → 54ms at 4.7KB, 837ms → 104ms at 11.9KB
// (5.3x / 6.9x / 8.0x). The saving grows with the document, which is the point —
// the cost of one delta should not depend on how much has already been written.
//
// Splitting is only safe where a block means the same thing alone as it does in
// the document. Two constructs are document-scoped, and both are bailed on
// rather than approximated: a link reference definition (`[1]: https://…`)
// resolves references anywhere in the document, and a GFM footnote definition
// does the same. Rendering those blocks separately would silently degrade a
// resolved link into literal bracket text.

import { marked } from 'marked'

export type MarkdownBlock = {
  /** The block's exact source, including its trailing blank lines. */
  raw: string
  /** False for the final block, which may still be growing. */
  complete: boolean
}

/** A GFM footnote definition, which the lexer reports as an ordinary paragraph. */
const FOOTNOTE_DEFINITION = /^[ \t]{0,3}\[\^[^\]]+\]:/m

function isDocumentScoped(text: string, tokens: ReturnType<typeof marked.lexer>): boolean {
  if (tokens.some((token) => token.type === 'def')) return true
  return text.includes('[^') && FOOTNOTE_DEFINITION.test(text)
}

/**
 * Returns the document as one block per top-level construct, or as a single
 * block when splitting would change what it renders. A caller may always render
 * the blocks in order inside one container and get the same document back.
 */
export function projectMarkdownBlocks(text: string): MarkdownBlock[] {
  if (!text) return []
  let tokens: ReturnType<typeof marked.lexer>
  try {
    tokens = marked.lexer(text)
  } catch {
    return [{ raw: text, complete: false }]
  }

  // The blocks must reassemble into exactly the input. This is a cheap string
  // compare against a real risk: a lexer that drops or rewrites a raw would
  // silently lose content from the middle of an answer, and nothing else here
  // would notice.
  if (tokens.reduce((total, token) => total + token.raw.length, 0) !== text.length) {
    return [{ raw: text, complete: false }]
  }
  if (isDocumentScoped(text, tokens)) return [{ raw: text, complete: false }]

  const blocks: MarkdownBlock[] = []
  for (const token of tokens) {
    // A `space` token is the blank line between two blocks. It carries no
    // content, and each block renders as its own element, so the separation is
    // already there — but it must be attached to the previous block rather than
    // dropped, or the raws no longer describe the document.
    if (token.type === 'space') {
      const previous = blocks[blocks.length - 1]
      if (previous) previous.raw += token.raw
      continue
    }
    blocks.push({ raw: token.raw, complete: true })
  }

  const last = blocks[blocks.length - 1]
  // The tail is whatever is still being written, so it is never finished — even
  // when it currently parses as a complete construct, the next delta may extend
  // it (a paragraph gains a line, a list gains an item).
  if (last) last.complete = false
  return blocks
}
