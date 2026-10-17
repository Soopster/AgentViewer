import { editorTextFromDisk, type EditorLineEnding } from './editorLineEndings'

/**
 * What the OpenTUI textarea actually holds. Measured, not assumed: handing it
 * 1.5 MiB keeps exactly 1,048,576 characters and discards the rest without a
 * word, so this is the buffer's capacity rather than a policy anyone chose.
 */
export const MAX_EDITOR_BUFFER_CHARS = 1024 * 1024

/** How much of the buffer a line boundary has to preserve to be worth using. */
const MIN_TRUNCATED_BUFFER_CHARS = Math.floor(MAX_EDITOR_BUFFER_CHARS * 0.9)

export type PreparedEditorBuffer = {
  /** LF-normalized, BOM-free text that fits the buffer. */
  content: string
  /** The file's own ending and mark, to restore when it is written back. */
  lineEnding: EditorLineEnding
  byteOrderMark: boolean
  /** Characters the whole file has, after newline normalization. */
  totalChars: number
  /** Set when `content` is a prefix of the file rather than all of it. */
  truncated: boolean
}

/**
 * The text to put in the buffer for a file, and whether it is all of it.
 *
 * The limit is counted in **characters**, because that is what the buffer
 * counts. Measuring the file in bytes instead refused files that would have fit
 * perfectly: a UTF-8 document of accented text or CJK runs to two or three
 * bytes per character, so a 1.4 MB file of 700,000 characters was rejected for
 * exceeding a limit it was nowhere near.
 *
 * A file that does not fit is **not** an error. Refusing to open it means the
 * one thing the editor could still usefully do — let someone read it — is not
 * possible either. It opens read-only instead, cut at a line boundary so the
 * last line on screen is a real line, and the caller is responsible for saying
 * so and for refusing to save it back.
 */
export function prepareEditorBuffer(raw: string): PreparedEditorBuffer {
  // The mark comes off here as well as the newlines: the terminal edit buffer
  // silently drops a leading U+FEFF, and the editor reads the resulting length
  // mismatch as the buffer having refused the file.
  const { content, lineEnding, byteOrderMark } = editorTextFromDisk(raw)
  const marks = { lineEnding, byteOrderMark }
  if (content.length <= MAX_EDITOR_BUFFER_CHARS) {
    return { content, totalChars: content.length, truncated: false, ...marks }
  }
  const cut = content.lastIndexOf('\n', MAX_EDITOR_BUFFER_CHARS - 1)
  // Cutting on a line boundary only helps when there is one near the limit. A
  // minified file is one enormous line after a short banner comment, and
  // honouring that boundary showed 212 bytes of a 1 MB file — the newline it
  // found was at the top. Below the floor, a hard cut mid-line is far better
  // than showing almost nothing.
  const end = cut >= MIN_TRUNCATED_BUFFER_CHARS ? cut + 1 : MAX_EDITOR_BUFFER_CHARS
  return { content: content.slice(0, end), totalChars: content.length, truncated: true, ...marks }
}

/** `1.2 MB`, for telling someone what they are looking at. */
export function formatEditorSize(chars: number): string {
  if (chars < 1024) return `${chars} B`
  if (chars < 1024 * 1024) return `${Math.round(chars / 1024)} KB`
  return `${(chars / (1024 * 1024)).toFixed(1)} MB`
}
