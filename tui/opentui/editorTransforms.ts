export type EditorTransformResult = { content: string; start: number; end: number }
export type EditorLineTransform = 'move-up' | 'move-down' | 'sort' | 'duplicate'

export function detectEditorIndentUnit(content: string, path = ''): string {
  let tabLines = 0
  const spaceIndents: number[] = []
  for (const line of content.split('\n').slice(0, 1_000)) {
    if (/^\t+\S/.test(line)) tabLines += 1
    const spaces = /^( +)\S/.exec(line)?.[1].length
    if (spaces) spaceIndents.push(spaces)
  }
  if (tabLines > spaceIndents.length) return '\t'
  if (spaceIndents.length > 0) return ' '.repeat(Math.max(2, Math.min(8, Math.min(...spaceIndents))))
  return /\.(?:py|rs|c|cc|cpp|h|hpp|java|kt|swift)$/i.test(path) ? '    ' : '  '
}

function startsFor(content: string): number[] {
  const starts = [0]
  for (let index = 0; index < content.length; index += 1) if (content[index] === '\n') starts.push(index + 1)
  return starts
}

function lineAt(starts: readonly number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (starts[middle]! <= offset) low = middle + 1
    else high = middle - 1
  }
  return Math.max(0, high)
}

function lineSelection(content: string, start: number, end: number) {
  const starts = startsFor(content)
  const normalizedStart = Math.max(0, Math.min(content.length, Math.min(start, end)))
  const normalizedEnd = Math.max(0, Math.min(content.length, Math.max(start, end)))
  const first = lineAt(starts, normalizedStart)
  const last = lineAt(starts, Math.max(normalizedStart, normalizedEnd - (normalizedEnd > normalizedStart ? 1 : 0)))
  return { starts, first, last, selected: normalizedEnd > normalizedStart, column: normalizedStart - starts[first]! }
}

function resultForLines(lines: string[], first: number, last: number, selected: boolean, column: number): EditorTransformResult {
  const content = lines.join('\n')
  const starts = startsFor(content)
  const start = starts[first] ?? content.length
  const lineEnd = last + 1 < starts.length ? starts[last + 1]! - 1 : content.length
  return selected
    ? { content, start, end: lineEnd }
    : { content, start: Math.min(lineEnd, start + column), end: Math.min(lineEnd, start + column) }
}

export function transformEditorLines(
  content: string,
  start: number,
  end: number,
  transform: EditorLineTransform,
): EditorTransformResult {
  const selection = lineSelection(content, start, end)
  const lines = content.split('\n')
  const block = lines.slice(selection.first, selection.last + 1)
  if (transform === 'move-up') {
    if (selection.first === 0) return { content, start, end }
    const previous = lines[selection.first - 1]!
    lines.splice(selection.first - 1, block.length + 1, ...block, previous)
    return resultForLines(lines, selection.first - 1, selection.last - 1, selection.selected, selection.column)
  }
  if (transform === 'move-down') {
    const nextIndex = selection.last + 1
    if (nextIndex >= lines.length || (nextIndex === lines.length - 1 && lines[nextIndex] === '')) return { content, start, end }
    const next = lines[nextIndex]!
    lines.splice(selection.first, block.length + 1, next, ...block)
    return resultForLines(lines, selection.first + 1, selection.last + 1, selection.selected, selection.column)
  }
  if (transform === 'sort') {
    const sorted = [...block].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
    lines.splice(selection.first, block.length, ...sorted)
    return resultForLines(lines, selection.first, selection.last, true, selection.column)
  }
  lines.splice(selection.last + 1, 0, ...block)
  const duplicateFirst = selection.last + 1
  return resultForLines(lines, duplicateFirst, duplicateFirst + block.length - 1, selection.selected, selection.column)
}

function identifierRange(content: string, offset: number): { start: number; end: number } {
  const identifier = /[\p{L}\p{N}\p{M}_$]/u
  let start = Math.max(0, Math.min(content.length, offset))
  let end = start
  while (start > 0) {
    const trailing = content.charCodeAt(start - 1)
    const width = trailing >= 0xDC00 && trailing <= 0xDFFF && start > 1
      && content.charCodeAt(start - 2) >= 0xD800 && content.charCodeAt(start - 2) <= 0xDBFF
      ? 2
      : 1
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
  return { start, end }
}

export function transformEditorCase(
  content: string,
  start: number,
  end: number,
  mode: 'upper' | 'lower',
): EditorTransformResult {
  const range = start === end ? identifierRange(content, start) : { start: Math.min(start, end), end: Math.max(start, end) }
  const source = content.slice(range.start, range.end)
  const replacement = mode === 'upper' ? source.toLocaleUpperCase() : source.toLocaleLowerCase()
  return {
    content: `${content.slice(0, range.start)}${replacement}${content.slice(range.end)}`,
    start: range.start,
    end: range.start + replacement.length,
  }
}

export function trimEditorTrailingWhitespace(content: string): EditorTransformResult {
  const next = content.replace(/[\t ]+$/gm, '')
  return { content: next, start: 0, end: 0 }
}
