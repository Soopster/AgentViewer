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

function positionAt(content: string, offset: number): { row: number; column: number } {
  let row = 0
  let lineStart = 0
  for (let index = 0; index < offset && index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      row += 1
      lineStart = index + 1
    }
  }
  return { row, column: offset - lineStart }
}

/**
 * The common prefix/suffix of the two contents, expressed as the single
 * replaced range tree-sitter needs. Editors emit one edit per keystroke, so
 * this recovers the exact edit for typing, and a correct (if coarse) one for a
 * paste, a formatter run, or a multi-cursor edit.
 */
export function editorSyntaxEdit(before: string, after: string): TreeSitterEdit | null {
  if (before === after) return null
  let start = 0
  const shortest = Math.min(before.length, after.length)
  while (start < shortest && before.charCodeAt(start) === after.charCodeAt(start)) start += 1
  let oldEnd = before.length
  let newEnd = after.length
  while (oldEnd > start && newEnd > start && before.charCodeAt(oldEnd - 1) === after.charCodeAt(newEnd - 1)) {
    oldEnd -= 1
    newEnd -= 1
  }
  const startPosition = positionAt(before, start)
  return {
    startIndex: start,
    oldEndIndex: oldEnd,
    newEndIndex: newEnd,
    startPosition,
    oldEndPosition: positionAt(before, oldEnd),
    newEndPosition: positionAt(after, newEnd),
  }
}

export function openEditorSyntaxBuffer(options: EditorSyntaxBufferOptions): EditorSyntaxBuffer {
  const client = getTreeSitterClient()
  const bufferId = nextBufferId++
  let content = options.content
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
      const edit = editorSyntaxEdit(content, after)
      void before
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
