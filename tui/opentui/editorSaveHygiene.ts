import type { EditorPosition, EditorTextEdit } from './editorLsp'

// What happens to a buffer between "the user pressed save" and "these bytes are
// written". Every step here is a pure string transform, deliberately: the save
// path needs the exact text it is about to write, and reading that back out of
// an async React state update after applying edits to the live buffer is how
// you write the wrong thing to disk.

/**
 * Offset of an LSP position in `content`. LSP counts UTF-16 code units, which
 * is what a JavaScript string index already is, so no conversion is needed —
 * but a position past the end of its line must clamp to the line end rather
 * than run into the next line.
 */
export function editorPositionOffset(content: string, lineStarts: readonly number[], position: EditorPosition): number {
  if (position.line < 0) return 0
  if (position.line >= lineStarts.length) return content.length
  const start = lineStarts[position.line]!
  const end = position.line + 1 < lineStarts.length ? lineStarts[position.line + 1]! - 1 : content.length
  return Math.max(start, Math.min(end, start + Math.max(0, position.character)))
}

export function editorLineStartOffsets(content: string): number[] {
  const starts = [0]
  for (let index = content.indexOf('\n'); index !== -1; index = content.indexOf('\n', index + 1)) {
    starts.push(index + 1)
  }
  return starts
}

/**
 * `content` with `edits` applied.
 *
 * LSP edits are all expressed against the *original* document, so they are
 * applied last-first — in document order every later range would be shifted by
 * the length the earlier ones changed, and formatting a file would scramble it.
 *
 * Overlapping or reversed edits mean the server contradicted itself, and there
 * is no safe way to guess what it meant, so this throws rather than writing a
 * spliced-together document. A column past the end of its line clamps to the
 * line end: the previous implementation resolved that to `null` and then
 * `slice(0, null)` silently truncated the file to nothing.
 */
export function applyEditorTextEdits(content: string, edits: readonly EditorTextEdit[]): string {
  if (edits.length === 0) return content
  const lineStarts = editorLineStartOffsets(content)
  const resolved = edits.map((edit) => ({
    start: editorPositionOffset(content, lineStarts, edit.range.start),
    end: editorPositionOffset(content, lineStarts, edit.range.end),
    newText: edit.newText,
  })).sort((left, right) => right.start - left.start || right.end - left.end)
  let boundary = content.length
  let output = content
  for (const edit of resolved) {
    if (edit.end < edit.start || edit.end > boundary) {
      throw new Error('Language server returned overlapping or invalid text edits')
    }
    output = `${output.slice(0, edit.start)}${edit.newText}${output.slice(edit.end)}`
    boundary = edit.start
  }
  return output
}

/**
 * Trailing spaces and tabs removed from every line.
 *
 * The line the caret is on is left alone when `caretLine` is given: trimming it
 * on save while someone is mid-indent deletes the whitespace they are standing
 * in and drops the caret to column 1.
 */
export function trimEditorTrailingWhitespace(content: string, caretLine?: number): string {
  const lines = content.split('\n')
  let changed = false
  for (let index = 0; index < lines.length; index += 1) {
    if (index === caretLine) continue
    const line = lines[index]!
    const trimmed = line.replace(/[ \t]+$/, '')
    if (trimmed !== line) {
      lines[index] = trimmed
      changed = true
    }
  }
  return changed ? lines.join('\n') : content
}

/**
 * A single trailing newline. An empty file stays empty — POSIX wants a newline
 * after every *line*, and a file with no lines has none to terminate.
 */
export function ensureEditorFinalNewline(content: string): string {
  if (content.length === 0 || content.endsWith('\n')) return content
  return `${content}\n`
}

export type EditorSaveHygiene = {
  trimTrailingWhitespace: boolean
  finalNewline: boolean
  formatOnSave: boolean
}

export const DEFAULT_EDITOR_SAVE_HYGIENE: EditorSaveHygiene = {
  // All off by default: every one of these rewrites lines the user did not
  // touch, and turning them on for someone else's repository turns a one-line
  // change into a whole-file diff. They are worth having, and worth choosing.
  trimTrailingWhitespace: false,
  finalNewline: false,
  formatOnSave: false,
}

/** The text-only part of save hygiene; formatting is applied by the caller. */
export function applyEditorSaveHygiene(
  content: string,
  hygiene: EditorSaveHygiene,
  caretLine?: number,
): string {
  let result = content
  if (hygiene.trimTrailingWhitespace) result = trimEditorTrailingWhitespace(result, caretLine)
  if (hygiene.finalNewline) result = ensureEditorFinalNewline(result)
  return result
}
