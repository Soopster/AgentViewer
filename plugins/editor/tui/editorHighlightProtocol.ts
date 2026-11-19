// Wire format between the editor's syntax facade and its Highlights worker.
//
// Everything crossing the thread boundary is plain data: edits, viewport
// ranges and scope captures. The tokenizer, its Wasm instance and every borrowed
// record view stay in the worker; `SyntaxStyle` and native objects stay on the
// render thread.

/** `[startCol, endCol, group]` with UTF-16 columns relative to the line. */
export type EditorHighlightCapture = readonly [startCol: number, endCol: number, group: string]
/** One line's complete decoration; an empty list means "no syntax here". */
export type EditorHighlightLine = readonly [line: number, captures: readonly EditorHighlightCapture[]]

export type EditorHighlightRange = readonly [startLine: number, endLine: number]

export type EditorHighlightEdit = {
  startLine: number
  startCharacter: number
  endLine: number
  endCharacter: number
  newText: string
}

export type EditorHighlightRequest =
  | { type: 'open'; id: number; generation: number; language: string; code: string; range: EditorHighlightRange }
  | { type: 'edit'; id: number; generation: number; seq: number; edit: EditorHighlightEdit; range: EditorHighlightRange }
  // Re-send every line's current tokens, viewport first. Used to recover from a
  // response that arrived after a newer edit and so could not be applied.
  | { type: 'snapshot'; id: number; generation: number; range: EditorHighlightRange }
  | { type: 'dispose'; id: number }

export type EditorHighlightResponse =
  | { type: 'lines'; id: number; generation: number; seq: number; initial: boolean; lines: EditorHighlightLine[] }
  | { type: 'unsupported'; id: number; generation: number }
  | { type: 'error'; id: number; generation: number; message: string }

const SCOPE_COLOR = /^var\(--hls-([\w-]+)\)$/

/** The semantic group for a Highlights token colour, or null for unstyled text.
 * Shares the display adapter's naming (`keyword-declaration` → `keyword.declaration`). */
export function editorHighlightGroup(color: string | undefined): string | null {
  const name = color?.match(SCOPE_COLOR)?.[1]
  if (!name || name === 'foreground') return null
  return name.replaceAll('-', '.')
}
