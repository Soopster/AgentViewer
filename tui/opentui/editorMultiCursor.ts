export type EditorCursorRange = { start: number; end: number }

export type EditorMultiCursorState = {
  ranges: EditorCursorRange[]
  activeIndex: number
}

export type EditorBlockSelectionState = {
  anchorLine: number
  anchorColumn: number
  headLine: number
  headColumn: number
}

export type EditorMultiCursorEdit = 'backspace' | 'delete' | { insert: string; caretOffset?: number }

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function normalized(range: EditorCursorRange, contentLength: number): EditorCursorRange {
  return {
    start: Math.max(0, Math.min(contentLength, Math.min(range.start, range.end))),
    end: Math.max(0, Math.min(contentLength, Math.max(range.start, range.end))),
  }
}

function identifierRange(content: string, offset: number): EditorCursorRange | null {
  const identifier = /[\p{L}\p{N}\p{M}_$]/u
  let start = Math.max(0, Math.min(content.length, offset))
  let end = start
  while (start > 0) {
    const trailing = content.charCodeAt(start - 1)
    const width = trailing >= 0xDC00 && trailing <= 0xDFFF && start > 1
      && content.charCodeAt(start - 2) >= 0xD800 && content.charCodeAt(start - 2) <= 0xDBFF
      ? 2
      : 1
    const character = content.slice(start - width, start)
    if (!identifier.test(content.slice(start - width, start))) break
    start -= width
  }
  while (end < content.length) {
    const codePoint = content.codePointAt(end)
    if (codePoint == null) break
    const character = String.fromCodePoint(codePoint)
    if (!identifier.test(character)) break
    end += character.length
  }
  return end > start ? { start, end } : null
}

function rangesOverlap(left: EditorCursorRange, right: EditorCursorRange): boolean {
  return left.start < right.end && right.start < left.end
}

export function addEditorCursorAtNextMatch(
  content: string,
  state: EditorMultiCursorState | null,
  selection: EditorCursorRange,
  cursorOffset: number,
): EditorMultiCursorState | null {
  const initial = normalized(selection, content.length)
  if (!state && initial.start === initial.end) {
    const word = identifierRange(content, cursorOffset)
    return word ? { ranges: [word], activeIndex: 0 } : null
  }
  const ranges = (state?.ranges ?? [initial]).map((range) => normalized(range, content.length))
  const activeIndex = Math.max(0, Math.min(ranges.length - 1, state?.activeIndex ?? 0))
  const active = ranges[activeIndex]
  if (!active || active.start === active.end) return null
  const pattern = content.slice(active.start, active.end)
  if (!pattern) return null
  const searchStarts = [active.end, 0]
  for (let pass = 0; pass < searchStarts.length; pass += 1) {
    let offset = searchStarts[pass]!
    const limit = pass === 0 ? content.length : active.end
    while (offset <= limit - pattern.length) {
      const match = content.indexOf(pattern, offset)
      if (match < 0 || match >= limit) break
      const candidate = { start: match, end: match + pattern.length }
      if (!ranges.some((range) => rangesOverlap(range, candidate))) {
        return { ranges: [...ranges, candidate], activeIndex: ranges.length }
      }
      offset = match + Math.max(1, pattern.length)
    }
  }
  return state ?? { ranges, activeIndex }
}

function lineStarts(content: string): number[] {
  const starts = [0]
  for (let index = 0; index < content.length; index += 1) if (content[index] === '\n') starts.push(index + 1)
  return starts
}

function lineIndexAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (starts[middle]! <= offset) low = middle + 1
    else high = middle - 1
  }
  return Math.max(0, high)
}

export function addEditorCursorOnAdjacentLine(
  content: string,
  state: EditorMultiCursorState | null,
  cursorOffset: number,
  direction: -1 | 1,
): EditorMultiCursorState | null {
  const ranges = state?.ranges ?? [{ start: cursorOffset, end: cursorOffset }]
  const activeIndex = state?.activeIndex ?? 0
  const active = normalized(ranges[activeIndex]!, content.length)
  const starts = lineStarts(content)
  const line = lineIndexAt(starts, active.end)
  const targetLine = line + direction
  if (targetLine < 0 || targetLine >= starts.length) return state
  const primary = normalized(ranges[0]!, content.length)
  const primaryLine = lineIndexAt(starts, primary.end)
  const column = primary.end - starts[primaryLine]!
  const targetStart = starts[targetLine]!
  const targetEnd = targetLine + 1 < starts.length ? starts[targetLine + 1]! - 1 : content.length
  const offset = Math.min(targetEnd, targetStart + column)
  if (ranges.some((range) => range.start === offset && range.end === offset)) return state
  return { ranges: [...ranges, { start: offset, end: offset }], activeIndex: ranges.length }
}

export function splitEditorSelectionIntoLineEndCursors(
  content: string,
  selection: EditorCursorRange,
): EditorMultiCursorState {
  const range = normalized(selection, content.length)
  const starts = lineStarts(content)
  const firstLine = lineIndexAt(starts, range.start)
  const lastLine = lineIndexAt(starts, Math.max(range.start, range.end - 1))
  const ranges: EditorCursorRange[] = []
  for (let line = firstLine; line <= lastLine; line += 1) {
    const end = line + 1 < starts.length ? starts[line + 1]! - 1 : content.length
    ranges.push({ start: end, end })
  }
  return { ranges, activeIndex: ranges.length - 1 }
}

export function updateEditorBlockSelection(
  content: string,
  block: EditorBlockSelectionState | null,
  cursorOffset: number,
  direction: 'left' | 'right' | 'up' | 'down',
): { block: EditorBlockSelectionState; cursors: EditorMultiCursorState } {
  const starts = lineStarts(content)
  const cursorLine = lineIndexAt(starts, Math.max(0, Math.min(content.length, cursorOffset)))
  const cursorColumn = cursorOffset - starts[cursorLine]!
  const next = block ? { ...block } : {
    anchorLine: cursorLine,
    anchorColumn: cursorColumn,
    headLine: cursorLine,
    headColumn: cursorColumn,
  }
  if (direction === 'left') next.headColumn = Math.max(0, next.headColumn - 1)
  if (direction === 'right') next.headColumn += 1
  if (direction === 'up') next.headLine = Math.max(0, next.headLine - 1)
  if (direction === 'down') next.headLine = Math.min(starts.length - 1, next.headLine + 1)
  const firstLine = Math.min(next.anchorLine, next.headLine)
  const lastLine = Math.max(next.anchorLine, next.headLine)
  const startColumn = Math.min(next.anchorColumn, next.headColumn)
  const endColumn = Math.max(next.anchorColumn, next.headColumn)
  const ranges: EditorCursorRange[] = []
  let activeIndex = 0
  for (let line = firstLine; line <= lastLine; line += 1) {
    const lineStart = starts[line]!
    const lineEnd = line + 1 < starts.length ? starts[line + 1]! - 1 : content.length
    const lineLength = lineEnd - lineStart
    ranges.push({
      start: lineStart + Math.min(startColumn, lineLength),
      end: lineStart + Math.min(endColumn, lineLength),
    })
    if (line === next.headLine) activeIndex = ranges.length - 1
  }
  return { block: next, cursors: { ranges, activeIndex } }
}

function previousGraphemeOffset(content: string, offset: number): number {
  if (offset <= 0) return 0
  const prefix = content.slice(0, offset)
  const segments = [...GRAPHEME_SEGMENTER.segment(prefix)]
  return segments.at(-1)?.index ?? 0
}

function nextGraphemeOffset(content: string, offset: number): number {
  if (offset >= content.length) return content.length
  const segment = GRAPHEME_SEGMENTER.segment(content.slice(offset))[Symbol.iterator]().next().value
  return offset + (segment?.segment.length ?? 0)
}

export function applyEditorMultiCursorEdit(
  content: string,
  state: EditorMultiCursorState,
  edit: EditorMultiCursorEdit,
): { content: string; state: EditorMultiCursorState } {
  const edits = state.ranges.map((rawRange, index) => {
    let range = normalized(rawRange, content.length)
    const replacement = typeof edit === 'object' ? edit.insert : ''
    if (range.start === range.end && edit === 'backspace') range = { start: previousGraphemeOffset(content, range.start), end: range.end }
    if (range.start === range.end && edit === 'delete') range = { start: range.start, end: nextGraphemeOffset(content, range.end) }
    return { ...range, replacement, caretOffset: typeof edit === 'object' ? edit.caretOffset ?? replacement.length : 0, index }
  }).sort((left, right) => left.start - right.start || left.end - right.end)

  const nonOverlapping: typeof edits = []
  for (const candidate of edits) {
    const previous = nonOverlapping.at(-1)
    if (!previous || candidate.start >= previous.end) nonOverlapping.push(candidate)
  }
  let sourceOffset = 0
  let nextContent = ''
  const caretByIndex = new Map<number, EditorCursorRange>()
  for (const current of nonOverlapping) {
    nextContent += content.slice(sourceOffset, current.start)
    nextContent += current.replacement
    const caret = nextContent.length - current.replacement.length + current.caretOffset
    caretByIndex.set(current.index, { start: caret, end: caret })
    sourceOffset = current.end
  }
  nextContent += content.slice(sourceOffset)
  const appliedIndices = state.ranges.map((_, index) => index).filter((index) => caretByIndex.has(index))
  const nextRanges = appliedIndices.map((index) => caretByIndex.get(index)!)
  const retainedActiveIndex = appliedIndices.indexOf(state.activeIndex)
  return {
    content: nextContent,
    state: {
      ranges: nextRanges,
      activeIndex: retainedActiveIndex >= 0 ? retainedActiveIndex : Math.max(0, nextRanges.length - 1),
    },
  }
}
