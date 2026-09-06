// Lightweight lexical classification of a document offset, used to keep the
// completion popup out of prose. It is deliberately not a parser: real editors
// suppress word suggestions inside comments and strings, and getting that
// right needs only the comment and quote delimiters for the filetype.

export type EditorOffsetKind = 'code' | 'comment' | 'string'

type LanguageSyntax = {
  lineComments: readonly string[]
  blockComments: readonly (readonly [string, string])[]
  quotes: readonly string[]
  /** Quote runs of three, as in Python docstrings, that swallow newlines. */
  tripleQuotes: readonly string[]
  /** Quotes that survive a line break, as in JS template literals. */
  multilineQuotes: readonly string[]
  brackets: readonly (readonly [string, string])[]
  /** Whether a line ending in `:` opens an indented block, as in Python. */
  colonOpensBlock: boolean
}

const DEFAULT_BRACKETS = [['(', ')'], ['[', ']'], ['{', '}']] as const

const C_FAMILY: LanguageSyntax = {
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  quotes: ['"', "'", '`'],
  tripleQuotes: [],
  multilineQuotes: ['`'],
  brackets: DEFAULT_BRACKETS,
  colonOpensBlock: false,
}

const HASH_FAMILY: LanguageSyntax = {
  lineComments: ['#'],
  blockComments: [],
  quotes: ['"', "'"],
  tripleQuotes: ['"""', "'''"],
  multilineQuotes: [],
  brackets: DEFAULT_BRACKETS,
  colonOpensBlock: true,
}

const SYNTAX_BY_EXTENSION: Readonly<Record<string, LanguageSyntax>> = {
  ts: C_FAMILY, tsx: C_FAMILY, js: C_FAMILY, jsx: C_FAMILY, mjs: C_FAMILY, cjs: C_FAMILY,
  c: C_FAMILY, h: C_FAMILY, cc: C_FAMILY, cpp: C_FAMILY, hpp: C_FAMILY, cs: C_FAMILY,
  go: C_FAMILY, java: C_FAMILY, kt: C_FAMILY, swift: C_FAMILY, rs: C_FAMILY, scala: C_FAMILY,
  php: C_FAMILY, dart: C_FAMILY, zig: C_FAMILY, css: { ...C_FAMILY, lineComments: [] },
  scss: C_FAMILY, less: C_FAMILY,
  py: HASH_FAMILY,
  rb: { ...HASH_FAMILY, tripleQuotes: [], colonOpensBlock: false },
  sh: { ...HASH_FAMILY, tripleQuotes: [], colonOpensBlock: false },
  bash: { ...HASH_FAMILY, tripleQuotes: [], colonOpensBlock: false },
  zsh: { ...HASH_FAMILY, tripleQuotes: [], colonOpensBlock: false },
  toml: { ...HASH_FAMILY, tripleQuotes: [], colonOpensBlock: false },
  yaml: { ...HASH_FAMILY, tripleQuotes: [] },
  yml: { ...HASH_FAMILY, tripleQuotes: [] },
  json: { lineComments: [], blockComments: [], quotes: ['"'], tripleQuotes: [], multilineQuotes: [], brackets: DEFAULT_BRACKETS, colonOpensBlock: false },
  sql: { ...C_FAMILY, lineComments: ['--'] },
  lua: { ...C_FAMILY, lineComments: ['--'], blockComments: [['--[[', ']]']] },
}

const PLAIN_TEXT: LanguageSyntax = {
  lineComments: [],
  blockComments: [],
  quotes: [],
  tripleQuotes: [],
  multilineQuotes: [],
  brackets: DEFAULT_BRACKETS,
  colonOpensBlock: false,
}

export function editorSyntaxForPath(path: string): LanguageSyntax {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase()
  return (extension ? SYNTAX_BY_EXTENSION[extension] : undefined) ?? PLAIN_TEXT
}

/**
 * Classify `offset` as code, comment, or string. The scan starts at the top of
 * the document because block comments and template literals span lines, but it
 * stops the moment it reaches `offset`, so cost tracks the prefix, not the file.
 */
export function classifyEditorOffset(content: string, offset: number, path: string): EditorOffsetKind {
  const syntax = editorSyntaxForPath(path)
  const target = Math.max(0, Math.min(content.length, offset))
  let index = 0
  while (index < target) {
    const character = content[index]!
    const lineComment = syntax.lineComments.find((token) => content.startsWith(token, index))
    if (lineComment) {
      const lineEnd = content.indexOf('\n', index)
      if (lineEnd < 0 || lineEnd >= target) return 'comment'
      index = lineEnd + 1
      continue
    }
    const blockComment = syntax.blockComments.find(([open]) => content.startsWith(open, index))
    if (blockComment) {
      const close = content.indexOf(blockComment[1], index + blockComment[0].length)
      if (close < 0 || close + blockComment[1].length > target) return 'comment'
      index = close + blockComment[1].length
      continue
    }
    const tripleQuote = syntax.tripleQuotes.find((token) => content.startsWith(token, index))
    if (tripleQuote) {
      const close = content.indexOf(tripleQuote, index + tripleQuote.length)
      if (close < 0 || close + tripleQuote.length > target) return 'string'
      index = close + tripleQuote.length
      continue
    }
    if (syntax.quotes.includes(character)) {
      const multiline = syntax.multilineQuotes.includes(character)
      let scan = index + 1
      while (scan < content.length) {
        const inner = content[scan]!
        if (inner === '\\') { scan += 2; continue }
        if (inner === character) break
        if (inner === '\n' && !multiline) break
        scan += 1
      }
      if (scan >= content.length) return 'string'
      if (content[scan] !== character) {
        // Unterminated on its line: an apostrophe in prose, not a string open.
        index += 1
        continue
      }
      if (scan >= target) return 'string'
      index = scan + 1
      continue
    }
    index += 1
  }
  return 'code'
}

export type EditorBracketMatch = { open: number; close: number }

/**
 * Find the bracket pair touching `offset`, the way an editor highlights the
 * partner of the bracket under (or immediately before) the cursor. Returns null
 * when the cursor is not on a bracket or the pair is unbalanced.
 */
export function matchingBracketAt(content: string, offset: number, path: string): EditorBracketMatch | null {
  const syntax = editorSyntaxForPath(path)
  const clamped = Math.max(0, Math.min(content.length, offset))
  for (const candidate of [clamped, clamped - 1]) {
    if (candidate < 0 || candidate >= content.length) continue
    const character = content[candidate]!
    const opening = syntax.brackets.find(([open]) => open === character)
    if (opening) {
      const close = scanBrackets(content, candidate, opening[0], opening[1], 1)
      if (close != null) return { open: candidate, close }
      continue
    }
    const closing = syntax.brackets.find(([, close]) => close === character)
    if (closing) {
      const open = scanBrackets(content, candidate, closing[1], closing[0], -1)
      if (open != null) return { open, close: candidate }
    }
  }
  return null
}

function scanBrackets(content: string, from: number, same: string, partner: string, step: 1 | -1): number | null {
  let depth = 0
  for (let index = from; index >= 0 && index < content.length; index += step) {
    const character = content[index]
    if (character === same) depth += 1
    else if (character === partner) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return null
}


/**
 * The indentation a closing bracket typed at `offset` should sit at: the
 * indentation of the line holding its opener. Returns null when the caret is
 * not on a blank line, the bracket is unbalanced, or the pair opened and closed
 * on the same line (where re-indenting would be wrong).
 */
export function indentForClosingBracket(
  content: string,
  offset: number,
  closer: string,
  path: string,
): string | null {
  const pair = editorSyntaxForPath(path).brackets.find(([, close]) => close === closer)
  if (!pair) return null
  const lineStart = content.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  if (!/^[\t ]*$/.test(content.slice(lineStart, offset))) return null
  let depth = 1
  for (let index = offset - 1; index >= 0; index -= 1) {
    const character = content[index]
    if (character === closer) depth += 1
    else if (character === pair[0]) {
      depth -= 1
      if (depth > 0) continue
      const openerLineStart = content.lastIndexOf('\n', Math.max(0, index - 1)) + 1
      if (openerLineStart === lineStart) return null
      return /^[\t ]*/.exec(content.slice(openerLineStart))?.[0] ?? ''
    }
  }
  return null
}
