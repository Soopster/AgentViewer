// Incremental textDocument/didChange for the editor's language client.
//
// The client used to send the whole document on every change notification —
// 572KB per keystroke in a 20,000-line file, serialized to JSON and pushed
// through a pipe, with the server re-reading all of it to find the one
// character that moved. LSP has had incremental sync since the beginning; the
// client simply never read the `textDocumentSync` capability that says whether
// the server accepts it.
//
// This module is the whole of the interesting part: turning two document
// states into the one replaced range that separates them, in the coordinates
// LSP expects. It is deliberately free of any transport so it can be tested
// without a language server, which matters because a wrong range here does not
// fail loudly — the server's copy of the file silently diverges from the
// editor's, and every completion, diagnostic and rename after that is computed
// against a document nobody is looking at.

export type LspPosition = { line: number; character: number }

export type LspContentChange =
  | { text: string }
  | { range: { start: LspPosition; end: LspPosition }; rangeLength: number; text: string }

/** LSP TextDocumentSyncKind. */
export const LSP_SYNC_NONE = 0
export const LSP_SYNC_FULL = 1
export const LSP_SYNC_INCREMENTAL = 2
export type LspSyncKind = typeof LSP_SYNC_NONE | typeof LSP_SYNC_FULL | typeof LSP_SYNC_INCREMENTAL

/**
 * What the server said it accepts. `textDocumentSync` is either the kind
 * itself or an options object carrying it under `change`.
 *
 * A server that says nothing is treated as wanting full documents rather than
 * the spec's literal default of None: None would mean never telling the server
 * about edits at all, and a server that omits the field in practice means "the
 * old default", not "do not sync me". Full is also what this client did before
 * it read the capability, so an unhelpful server is no worse off than it was.
 */
export function lspSyncKind(capability: unknown): LspSyncKind {
  const raw = capability && typeof capability === 'object'
    ? (capability as { change?: unknown }).change
    : capability
  if (raw === LSP_SYNC_NONE || raw === LSP_SYNC_FULL || raw === LSP_SYNC_INCREMENTAL) return raw
  return LSP_SYNC_FULL
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/**
 * The single range that turns `before` into `after`, as the common prefix and
 * suffix that bracket it.
 *
 * One range is always a correct description of one edit, and a correct if
 * coarse description of any other change — a paste, a formatter run, a
 * multi-cursor edit. It is not a minimal diff and does not try to be: the point
 * is to stop sending the whole file, not to send the smallest possible patch.
 */
export function lspChangedRange(
  before: string,
  after: string,
): { start: number; oldEnd: number; newEnd: number } | null {
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
  // A boundary must never land between the halves of a surrogate pair: LSP
  // positions are UTF-16 code unit offsets, but half a pair is not a character,
  // and a server rebuilding the document from one would produce mojibake it can
  // never recover from. Widen the range to swallow any pair it splits.
  if (start > 0 && isLowSurrogate(before.charCodeAt(start)) && isHighSurrogate(before.charCodeAt(start - 1))) {
    start -= 1
  }
  if (oldEnd < before.length && isLowSurrogate(before.charCodeAt(oldEnd)) && isHighSurrogate(before.charCodeAt(oldEnd - 1))) {
    oldEnd += 1
    newEnd += 1
  }
  return { start, oldEnd, newEnd }
}

/**
 * Line/character for two offsets into the same string, in one pass. Character
 * is a UTF-16 code unit offset within the line, which is LSP's default
 * position encoding and happens to be exactly what a JavaScript string index
 * already is.
 */
function positionsAt(content: string, first: number, second: number): [LspPosition, LspPosition] {
  // Requires first <= second, which the changed range always satisfies.
  let line = 0
  let lineStart = 0
  let index = 0
  for (; index < first; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1
      lineStart = index + 1
    }
  }
  const firstPosition: LspPosition = { line, character: first - lineStart }
  for (; index < second; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1
      lineStart = index + 1
    }
  }
  return [firstPosition, { line, character: second - lineStart }]
}

/**
 * The `contentChanges` for one didChange notification. Returns an empty array
 * when there is nothing to report, so the caller can skip the notification
 * entirely rather than bump the document version for a no-op.
 */
export function lspContentChanges(before: string, after: string, syncKind: LspSyncKind): LspContentChange[] {
  if (syncKind === LSP_SYNC_NONE) return []
  if (before === after) return []
  if (syncKind === LSP_SYNC_FULL) return [{ text: after }]
  const changed = lspChangedRange(before, after)
  if (!changed) return []
  const [start, end] = positionsAt(before, changed.start, changed.oldEnd)
  return [{
    range: { start, end },
    // Deprecated in the spec but still read by servers written against older
    // versions, and cheap to be right about.
    rangeLength: changed.oldEnd - changed.start,
    text: after.slice(changed.start, changed.newEnd),
  }]
}

/**
 * Applies a change the way a conforming server would. Only used by tests — it
 * is how "the server's document still matches the editor's" is asserted
 * without a server.
 */
export function applyLspContentChange(document: string, change: LspContentChange): string {
  if (!('range' in change)) return change.text
  const offsetOf = (position: LspPosition): number => {
    let line = 0
    let index = 0
    while (line < position.line && index < document.length) {
      if (document.charCodeAt(index) === 10) line += 1
      index += 1
    }
    return Math.min(document.length, index + position.character)
  }
  return `${document.slice(0, offsetOf(change.range.start))}${change.text}${document.slice(offsetOf(change.range.end))}`
}
