// Line endings are normalized at the file boundary, not carried through the
// editor.
//
// The terminal edit buffer strips carriage returns on load, so a file written
// with CRLF came back from the buffer as LF and was saved that way: opening a
// Windows-authored file, typing one character and saving rewrote every line in
// it. A one-character edit became a whole-file diff, silently.
//
// So the buffer only ever holds LF — which is what every offset, line table and
// tree-sitter edit in the editor already assumes — and the file's own ending is
// remembered beside it and restored on write. Reads normalize before any
// comparison too, or the disk watcher would see a CRLF file as permanently
// changed against its own LF copy.
export type EditorLineEnding = '\n' | '\r\n'

/**
 * The ending to write this file back with. A file with any CRLF at all is
 * treated as a CRLF file: mixed endings are usually an accident of tooling,
 * and picking the dominant one is what editors do rather than preserving the
 * mixture line by line.
 */
export function detectEditorLineEnding(raw: string): EditorLineEnding {
  return raw.includes('\r\n') ? '\r\n' : '\n'
}

/** CRLF and lone-CR endings collapsed to the LF the buffer works in. */
export function normalizeEditorNewlines(raw: string): string {
  return raw.includes('\r') ? raw.replace(/\r\n?/g, '\n') : raw
}

/** The buffer's LF content written back with the file's own ending. */
export function applyEditorLineEnding(content: string, lineEnding: EditorLineEnding): string {
  return lineEnding === '\n' ? content : content.replace(/\n/g, '\r\n')
}

// A byte order mark is the same kind of boundary detail as a line ending, and
// it fails harder. The terminal edit buffer silently drops a leading U+FEFF —
// 13 characters in, 12 out — and the editor's integrity check reads any such
// mismatch as the buffer having refused the file, so it closed the tab and
// reported that the file "did not fit the editor buffer". Visual Studio writes
// a UTF-8 BOM into most files it creates, so on Windows that was not an edge
// case: it was most files, at any size, reported as a buffer-capacity problem.
//
// So the mark is stripped for the buffer and remembered beside it, exactly like
// the line ending, and restored on write. Dropping it instead would rewrite the
// first bytes of every Windows-authored file the first time it was saved.
export const EDITOR_BYTE_ORDER_MARK = '\uFEFF'

export type EditorFileEncodingMarks = {
  lineEnding: EditorLineEnding
  byteOrderMark: boolean
}

/** The text without its leading byte order mark, and whether it had one. */
export function stripEditorByteOrderMark(raw: string): { content: string; byteOrderMark: boolean } {
  return raw.startsWith(EDITOR_BYTE_ORDER_MARK)
    ? { content: raw.slice(EDITOR_BYTE_ORDER_MARK.length), byteOrderMark: true }
    : { content: raw, byteOrderMark: false }
}

/** The buffer's text written back with the file's own mark restored. */
export function applyEditorByteOrderMark(content: string, byteOrderMark: boolean): string {
  if (!byteOrderMark || content.startsWith(EDITOR_BYTE_ORDER_MARK)) return content
  return `${EDITOR_BYTE_ORDER_MARK}${content}`
}

/**
 * A file's text as the buffer must hold it — no mark, LF only — beside what has
 * to be put back when it is written. Every read of a file goes through this, or
 * a comparison somewhere sees a file as permanently changed against its own
 * copy.
 */
export function editorTextFromDisk(raw: string): { content: string } & EditorFileEncodingMarks {
  const { content, byteOrderMark } = stripEditorByteOrderMark(raw)
  return {
    content: normalizeEditorNewlines(content),
    lineEnding: detectEditorLineEnding(content),
    byteOrderMark,
  }
}

/** The bytes to write for a buffer, with the file's own marks restored. */
export function editorTextToDisk(content: string, marks: EditorFileEncodingMarks): string {
  return applyEditorByteOrderMark(applyEditorLineEnding(content, marks.lineEnding), marks.byteOrderMark)
}

export function isEditorLineEnding(value: unknown): value is EditorLineEnding {
  return value === '\n' || value === '\r\n'
}

// Encoding is the other half of the file boundary, and it fails the same way:
// `readFile(path, 'utf8')` never reports a bad byte, it substitutes U+FFFD. A
// Latin-1 or binary file therefore opens looking plausible, and the first save
// writes the replacement character back over the original bytes — `63 61 66 E9`
// ("café" in Latin-1) becomes `63 61 66 EF BF BD`, whole-file and silent.
//
// So a file the editor cannot represent losslessly is refused rather than
// mangled. Two things disqualify one: bytes that are not valid UTF-8, and NUL
// bytes, which the terminal edit buffer cannot hold (and which are every other
// tool's definition of "binary").
export class EditorEncodingError extends Error {
  readonly path: string | undefined

  constructor(reason: string, path?: string) {
    super(path ? `${path} ${reason}` : reason)
    this.name = 'EditorEncodingError'
    this.path = path
  }
}

// `ignoreBOM` keeps a leading U+FEFF as a character instead of consuming it, so
// a BOM survives the round trip back to disk as the same three bytes.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** UTF-8 bytes as editor text, or `EditorEncodingError` if that would lose data. */
export function decodeEditorFileText(bytes: Uint8Array, path?: string): string {
  let text: string
  try {
    text = strictUtf8.decode(bytes)
  } catch {
    throw new EditorEncodingError('is not valid UTF-8; the editor will not open a file it cannot save back unchanged', path)
  }
  if (text.includes('\0')) {
    throw new EditorEncodingError('contains NUL bytes and cannot be edited as text', path)
  }
  return text
}
