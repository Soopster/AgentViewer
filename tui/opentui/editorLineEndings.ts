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
