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
