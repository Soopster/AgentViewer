import { displayHighlightClient } from '../displayHighlightClient'
import { infoStringToFiletype, rgbToHex, treeSitterToTextChunks, type SyntaxStyle, type RGBA } from '@opentui/core'
import type { InlineTextSegment } from './inlineText'

// Highlights colour for the code a tool printed. The parse is async and runs in the display worker, so a
// row asks, draws the regex tokenizer's answer meanwhile, and redraws from here once the parse lands.
// Parsing a block as a whole is what makes it accurate: a template string or comment spanning rows is seen as one.

const MAX_ENTRIES = 400
const cache = new Map<string, InlineTextSegment[][]>()
const pending = new Set<string>()
const listeners = new Set<() => void>()
let version = 0
const styleIds = new WeakMap<object, number>()
let nextStyleId = 1

const styleId = (style: SyntaxStyle) => {
  let id = styleIds.get(style)
  if (!id) styleIds.set(style, id = nextStyleId++)
  return id
}

export function subscribeToolOutputSyntax(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const toolOutputSyntaxVersion = () => version

/** OpenTUI's name for a file extension or language word, or null when it has no grammar. */
export function treeSitterFiletype(languageWord: string): string | null {
  const filetype = infoStringToFiletype(languageWord)
  return filetype && filetype !== 'txt' ? filetype : null
}

const hex = (color: RGBA | undefined, fallback: string) => color ? rgbToHex(color) : fallback

function toLines(text: string, chunks: ReturnType<typeof treeSitterToTextChunks>, fallbackFg: string): InlineTextSegment[][] {
  const lines: InlineTextSegment[][] = [[]]
  for (const chunk of chunks) {
    const parts = chunk.text.split('\n')
    parts.forEach((part, index) => {
      if (index > 0) lines.push([])
      if (part) lines[lines.length - 1]!.push({ text: part, fg: hex(chunk.fg, fallbackFg), attributes: chunk.attributes })
    })
  }
  // Reassembly must equal the input, or a row would show text that is not there.
  return lines.map(line => line.map(segment => segment.text).join('')).join('\n') === text ? lines : []
}

/**
 * The block's lines as coloured segments, or null while the parse is outstanding (the call starts it).
 * `fallbackFg` colours text the grammar leaves unstyled.
 */
export function peekToolOutputSyntax(text: string, filetype: string, style: SyntaxStyle, fallbackFg: string): InlineTextSegment[][] | null {
  const key = `${styleId(style)}\0${filetype}\0${fallbackFg}\0${text}`
  const hit = cache.get(key)
  if (hit) return hit.length ? hit : null
  if (pending.has(key)) return null
  pending.add(key)
  void displayHighlightClient.highlightOnce(text, filetype).then(
    result => treeSitterToTextChunks(text, result.highlights ?? [], style, { enabled: false }),
    () => null,
  ).then(chunks => {
    pending.delete(key)
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!)
    cache.set(key, chunks ? toLines(text, chunks, fallbackFg) : [])
    version += 1
    for (const listener of listeners) listener()
  })
  return null
}

/** For tests: forget every parse. */
export function resetToolOutputSyntax(): void {
  cache.clear()
  pending.clear()
  version += 1
}
