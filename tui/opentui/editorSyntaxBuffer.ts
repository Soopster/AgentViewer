// Incremental tree-sitter highlighting for the project editor.
//
// The editor used to re-highlight the whole file after every keystroke:
// `highlightOnce(entireBuffer)` re-parsed from scratch and the result was
// applied with one `addHighlight` call per token per line. In a 6,000-line
// TypeScript file that is a 181ms parse and 112,013 highlight calls, 90ms
// after every character typed — the cost of a keystroke grew with the size of
// the file, which is the one thing a text editor may not do.
//
// The tree-sitter client already exposes the incremental path: a buffer is
// created once, edits are pushed as tree-sitter `Edit` ranges, and the worker
// answers with highlights for **only the lines it re-parsed** — one line for a
// one-character insert, at 1.0ms in the same 6,000-line file and 2.7ms at
// 20,000. This module owns that buffer's lifecycle so `EditorPopover` deals in
// "apply these lines" rather than in worker protocol.
import { getTreeSitterClient } from '@opentui/core'
import type { HighlightResponse } from '@opentui/core'

// The client's own per-line highlight shape: `{ line, highlights: [{ startCol,
// endCol, group }] }`. Re-exported so callers need not import worker types.
export type EditorSyntaxLine = HighlightResponse

export type EditorSyntaxBufferOptions = {
  content: string
  filetype: string
  // Called with the lines the parser re-highlighted. `full` marks the initial
  // parse of a newly opened buffer, where every line is present and the caller
  // may clear what it had; an incremental batch names only changed lines and
  // must leave every other line's decoration alone.
  onHighlights: (lines: EditorSyntaxLine[], full: boolean) => void
}

export type EditorSyntaxBuffer = {
  /** Push an edit derived from the previous and current buffer contents. */
  update: (before: string, after: string) => void
  /** Content this buffer believes the parser holds, for reconciling a diverged editor. */
  readonly content: string
  dispose: () => void
}

let nextBufferId = 1

type TreeSitterEdit = {
  startIndex: number
  oldEndIndex: number
  newEndIndex: number
  startPosition: { row: number; column: number }
  oldEndPosition: { row: number; column: number }
  newEndPosition: { row: number; column: number }
}

// A `charCodeAt` loop walks the common prefix one code unit at a time, so an
// append to a 20,000-line file compared 856,716 of them per keystroke — 0.97ms
// of pure comparison, growing with the file rather than with the edit. Engine
// string equality is a memcmp over the whole block, so comparing in blocks and
// only stepping code units inside the one block that differs is ~15x cheaper
// (0.066ms at the same size) for exactly the same answer.
const SCAN_BLOCK = 4096

function commonPrefixLength(before: string, after: string): number {
  const shortest = Math.min(before.length, after.length)
  let index = 0
  while (index + SCAN_BLOCK <= shortest
    && before.substring(index, index + SCAN_BLOCK) === after.substring(index, index + SCAN_BLOCK)) {
    index += SCAN_BLOCK
  }
  while (index < shortest && before.charCodeAt(index) === after.charCodeAt(index)) index += 1
  return index
}

/** How far back from each end the two contents agree, never crossing `start`. */
function commonSuffixLength(before: string, after: string, start: number): number {
  const limit = Math.min(before.length - start, after.length - start)
  let length = 0
  while (length + SCAN_BLOCK <= limit
    && before.substring(before.length - length - SCAN_BLOCK, before.length - length)
      === after.substring(after.length - length - SCAN_BLOCK, after.length - length)) {
    length += SCAN_BLOCK
  }
  while (length < limit
    && before.charCodeAt(before.length - length - 1) === after.charCodeAt(after.length - length - 1)) {
    length += 1
  }
  return length
}

/** Offsets of the first character of every line: `[0, …after each newline]`. */
export function editorLineStarts(content: string): number[] {
  const starts = [0]
  for (let index = content.indexOf('\n'); index >= 0; index = content.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  return starts
}

/** The row holding `offset`: the last line start at or before it. */
function rowAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid]! <= offset) low = mid
    else high = mid - 1
  }
  return low
}

/**
 * The line table for `after`, derived from the one for `before` plus the single
 * replaced range between them. Lines before the edit keep their offsets, lines
 * inside it are rescanned (bounded by the edit, not the file), and lines after
 * it shift by the edit's length delta — so a keystroke costs one binary search
 * and a handful of integer adds instead of a fresh pass over the whole buffer.
 */
export function advanceLineStarts(
  beforeStarts: readonly number[],
  after: string,
  start: number,
  oldEnd: number,
  newEnd: number,
  startRow: number,
): number[] {
  const starts = beforeStarts.slice(0, startRow + 1)
  for (let index = after.indexOf('\n', start); index >= 0 && index < newEnd; index = after.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  const delta = newEnd - oldEnd
  // Everything strictly past the replaced range survives, shifted. A line start
  // sitting exactly on `oldEnd` came from a newline inside the range and is
  // re-derived by the scan above, so skipping it here cannot lose or duplicate one.
  let tail = rowAt(beforeStarts, oldEnd)
  while (tail < beforeStarts.length && beforeStarts[tail]! <= oldEnd) tail += 1
  for (; tail < beforeStarts.length; tail += 1) starts.push(beforeStarts[tail]! + delta)
  return starts
}

/**
 * The common prefix/suffix of the two contents, expressed as the single
 * replaced range tree-sitter needs. Editors emit one edit per keystroke, so
 * this recovers the exact edit for typing, and a correct (if coarse) one for a
 * paste, a formatter run, or a multi-cursor edit.
 *
 * `beforeStarts` is the line table for `before`; passing the one the caller
 * already holds is what keeps the cost proportional to the edit. Omitting it is
 * correct but rebuilds the table, which is a full pass over `before`.
 */
export function editorSyntaxEdit(
  before: string,
  after: string,
  beforeStarts?: readonly number[],
): TreeSitterEdit | null {
  if (before === after) return null
  const start = commonPrefixLength(before, after)
  const suffix = commonSuffixLength(before, after, start)
  const oldEnd = before.length - suffix
  const newEnd = after.length - suffix
  const starts = beforeStarts ?? editorLineStarts(before)

  const startRow = rowAt(starts, start)
  const startColumn = start - starts[startRow]!
  const oldEndRow = rowAt(starts, oldEnd)

  // The new end is found by walking only the replacement text, whose length is
  // the size of the edit.
  let newEndRow = startRow
  let newEndLineStart = starts[startRow]!
  for (let index = after.indexOf('\n', start); index >= 0 && index < newEnd; index = after.indexOf('\n', index + 1)) {
    newEndRow += 1
    newEndLineStart = index + 1
  }

  return {
    startIndex: start,
    oldEndIndex: oldEnd,
    newEndIndex: newEnd,
    startPosition: { row: startRow, column: startColumn },
    oldEndPosition: { row: oldEndRow, column: oldEnd - starts[oldEndRow]! },
    newEndPosition: { row: newEndRow, column: newEnd - newEndLineStart },
  }
}

export function openEditorSyntaxBuffer(options: EditorSyntaxBufferOptions): EditorSyntaxBuffer {
  const client = getTreeSitterClient()
  const bufferId = nextBufferId++
  let content = options.content
  // The line table for `content`, carried across edits so neither the edit
  // computation nor the next table costs a pass over the whole buffer.
  let lineStarts: readonly number[] = editorLineStarts(content)
  let version = 1
  let disposed = false
  // Until the initial parse lands, every response is the whole file; after it,
  // a response names only the lines the parser touched.
  let seenFirstResponse = false

  const onResponse = (responseBufferId: number, _version: number, lines: readonly EditorSyntaxLine[]) => {
    if (disposed || responseBufferId !== bufferId) return
    const full = !seenFirstResponse
    seenFirstResponse = true
    options.onHighlights([...lines], full)
  }
  client.on('highlights:response', onResponse)

  void client.createBuffer(bufferId, content, options.filetype, version).catch(() => {})

  return {
    get content() { return content },
    update(before: string, after: string) {
      if (disposed || after === content) return
      // Reconcile against what the parser holds, not against what the caller
      // believed: a dropped update would otherwise desynchronise every edit
      // after it, and tree-sitter edits are only valid against the exact tree
      // they were computed from.
      const edit = editorSyntaxEdit(content, after, lineStarts)
      void before
      lineStarts = edit == null
        ? editorLineStarts(after)
        : advanceLineStarts(lineStarts, after, edit.startIndex, edit.oldEndIndex, edit.newEndIndex, edit.startPosition.row)
      content = after
      version += 1
      if (!edit) return
      void client.updateBuffer(bufferId, [edit], after, version).catch(() => {})
    },
    dispose() {
      if (disposed) return
      disposed = true
      client.off('highlights:response', onResponse)
      void client.removeBuffer(bufferId).catch(() => {})
    },
  }
}
