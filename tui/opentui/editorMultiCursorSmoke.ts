import {
  addEditorCursorAtNextMatch,
  addEditorCursorOnAdjacentLine,
  applyEditorMultiCursorEdit,
  splitEditorSelectionIntoLineEndCursors,
  updateEditorBlockSelection,
} from './editorMultiCursor'

const source = 'const café = café + café\n'
let state = addEditorCursorAtNextMatch(source, null, { start: 6, end: 6 }, 7)
if (!state || source.slice(state.ranges[0]!.start, state.ranges[0]!.end) !== 'café') {
  throw new Error(`Ctrl+D did not select the Unicode identifier: ${JSON.stringify(state)}`)
}
state = addEditorCursorAtNextMatch(source, state, state.ranges[state.activeIndex]!, state.ranges[state.activeIndex]!.end)
state = state && addEditorCursorAtNextMatch(source, state, state.ranges[state.activeIndex]!, state.ranges[state.activeIndex]!.end)
if (!state || state.ranges.length !== 3) throw new Error(`Ctrl+D did not collect all matches: ${JSON.stringify(state)}`)

const replaced = applyEditorMultiCursorEdit(source, state, { insert: 'drink' })
if (replaced.content !== 'const drink = drink + drink\n' || replaced.state.ranges.some((range) => range.start !== range.end)) {
  throw new Error(`Multi-cursor insertion did not replace every selection atomically: ${JSON.stringify(replaced)}`)
}

const emoji = applyEditorMultiCursorEdit('A👩‍💻B A👩‍💻B', {
  ranges: [{ start: 6, end: 6 }, { start: 14, end: 14 }],
  activeIndex: 1,
}, 'backspace')
if (emoji.content !== 'AB AB') throw new Error(`Multi-cursor backspace split a grapheme cluster: ${JSON.stringify(emoji)}`)

const overlapping = applyEditorMultiCursorEdit('abcdef', {
  ranges: [{ start: 0, end: 5 }, { start: 1, end: 2 }, { start: 6, end: 6 }],
  activeIndex: 1,
}, { insert: 'X' })
if (overlapping.content !== 'XfX' || overlapping.state.ranges.length !== 2) {
  throw new Error(`Overlapping cursor edits were not consolidated safely: ${JSON.stringify(overlapping)}`)
}

let vertical = addEditorCursorOnAdjacentLine('alpha\nb\ngamma', null, 4, 1)
vertical = addEditorCursorOnAdjacentLine('alpha\nb\ngamma', vertical, vertical!.ranges[vertical!.activeIndex]!.end, 1)
if (!vertical || JSON.stringify(vertical.ranges) !== JSON.stringify([
  { start: 4, end: 4 }, { start: 7, end: 7 }, { start: 12, end: 12 },
])) throw new Error(`Adjacent-line cursors did not clamp visual columns: ${JSON.stringify(vertical)}`)

const lineEnds = splitEditorSelectionIntoLineEndCursors('one\ntwo\nthree', { start: 1, end: 9 })
if (JSON.stringify(lineEnds.ranges) !== JSON.stringify([
  { start: 3, end: 3 }, { start: 7, end: 7 }, { start: 13, end: 13 },
])) throw new Error(`Split selection did not create one cursor per line end: ${JSON.stringify(lineEnds)}`)

let block = updateEditorBlockSelection('alpha\nb\ngamma', null, 1, 'right')
block = updateEditorBlockSelection('alpha\nb\ngamma', block.block, 1, 'right')
block = updateEditorBlockSelection('alpha\nb\ngamma', block.block, 1, 'down')
if (JSON.stringify(block.cursors.ranges) !== JSON.stringify([
  { start: 1, end: 3 }, { start: 7, end: 7 },
])) throw new Error(`Rectangular selection did not clamp each line safely: ${JSON.stringify(block)}`)

console.log('Editor Unicode multi-cursor match/vertical/block/line-end/edit/grapheme smoke passed')

// --- Adversarial cases: ill-formed offsets, adjacency, and degenerate state ---

// A rectangular selection is column arithmetic over UTF-16 units, so its edges
// can land between the halves of a surrogate pair. Editing there would write a
// lone surrogate into the file, which renders fine and is not valid text.
const emojiLine = 'a\u{1F600}b\ncdef'
let rect = updateEditorBlockSelection(emojiLine, null, 0, 'right')
rect = updateEditorBlockSelection(emojiLine, rect.block, 0, 'right')
rect = updateEditorBlockSelection(emojiLine, rect.block, 0, 'down')
if (JSON.stringify(rect.cursors.ranges) !== JSON.stringify([{ start: 0, end: 3 }, { start: 5, end: 7 }])) {
  throw new Error(`Block selection highlighted half a code point: ${JSON.stringify(rect.cursors.ranges)}`)
}
const rectEdit = applyEditorMultiCursorEdit(emojiLine, rect.cursors, { insert: 'X' })
if (/[\uD800-\uDFFF]/.test(rectEdit.content.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))) {
  throw new Error(`Block-selection edit left a lone surrogate in the buffer: ${JSON.stringify(rectEdit.content)}`)
}
if (rectEdit.content !== 'Xb\nXef') throw new Error(`Block-selection edit did not consume whole code points: ${JSON.stringify(rectEdit)}`)

// The same protection has to hold for a range handed in directly, since a stale
// cursor offset survives an edit that moved the text under it.
const splitRange = applyEditorMultiCursorEdit('a\u{1F600}b', { ranges: [{ start: 1, end: 2 }], activeIndex: 0 }, { insert: '' })
if (splitRange.content !== 'ab') throw new Error(`Half-pair deletion corrupted the buffer: ${JSON.stringify(splitRange.content)}`)
const splitCaret = applyEditorMultiCursorEdit('a\u{1F600}b', { ranges: [{ start: 2, end: 2 }], activeIndex: 0 }, { insert: 'X' })
if (splitCaret.content !== 'aX\u{1F600}b') throw new Error(`Insertion at a mid-pair caret split the emoji: ${JSON.stringify(splitCaret.content)}`)

// A cursor state with no usable active range must be returned unchanged, not
// dereferenced — applyEditorMultiCursorEdit can itself produce ranges: [].
const emptied = applyEditorMultiCursorEdit('abc', { ranges: [], activeIndex: 0 }, { insert: 'X' })
if (emptied.content !== 'abc' || emptied.state.ranges.length !== 0) throw new Error('An empty cursor set must be a no-op')
if (addEditorCursorOnAdjacentLine('a\nb', emptied.state, 0, 1) !== emptied.state) {
  throw new Error('Adjacent-line cursor on an empty cursor set must return the state unchanged')
}
if (addEditorCursorOnAdjacentLine('a\nb', { ranges: [{ start: 0, end: 0 }], activeIndex: 7 }, 0, 1)?.ranges.length !== 2) {
  throw new Error('Adjacent-line cursor must clamp an out-of-range activeIndex instead of throwing')
}

// Adjacent (touching) ranges are independent edits; neither may be shifted by
// the other, and neither may be dropped as an overlap.
const adjacent = applyEditorMultiCursorEdit('abcdef', {
  ranges: [{ start: 0, end: 2 }, { start: 2, end: 4 }],
  activeIndex: 1,
}, { insert: 'X' })
if (adjacent.content !== 'XXef' || JSON.stringify(adjacent.state.ranges) !== JSON.stringify([{ start: 1, end: 1 }, { start: 2, end: 2 }])) {
  throw new Error(`Adjacent cursor ranges were not applied independently: ${JSON.stringify(adjacent)}`)
}

// Later edits must be placed against the original content, not against the text
// earlier edits already grew, and the returned carets keep their input order.
const unsorted = applyEditorMultiCursorEdit('abcdef', {
  ranges: [{ start: 4, end: 5 }, { start: 0, end: 1 }],
  activeIndex: 0,
}, { insert: 'XY' })
if (unsorted.content !== 'XYbcdXYf'
  || JSON.stringify(unsorted.state.ranges) !== JSON.stringify([{ start: 7, end: 7 }, { start: 2, end: 2 }])
  || unsorted.state.activeIndex !== 0) {
  throw new Error(`Out-of-order cursor edits shifted each other: ${JSON.stringify(unsorted)}`)
}

// A cursor left dangling past the end of a shortened buffer clamps to EOF.
const dangling = applyEditorMultiCursorEdit('abc', {
  ranges: [{ start: 99, end: 120 }, { start: 1, end: 1 }],
  activeIndex: 1,
}, { insert: 'X' })
if (dangling.content !== 'aXbcX' || dangling.state.activeIndex !== 1) {
  throw new Error(`Dangling cursor was not clamped to the buffer end: ${JSON.stringify(dangling)}`)
}

// Backspace at offset 0 and delete at EOF are no-ops, not off-buffer slices.
if (applyEditorMultiCursorEdit('abc', { ranges: [{ start: 0, end: 0 }], activeIndex: 0 }, 'backspace').content !== 'abc'
  || applyEditorMultiCursorEdit('abc', { ranges: [{ start: 3, end: 3 }], activeIndex: 0 }, 'delete').content !== 'abc') {
  throw new Error('Backspace at 0 / delete at EOF must leave the buffer untouched')
}

// Backspace removes a whole grapheme cluster, combining marks included.
const decomposed = applyEditorMultiCursorEdit('caféx', { ranges: [{ start: 6, end: 6 }], activeIndex: 0 }, 'backspace')
const clusterDelete = applyEditorMultiCursorEdit('caféx', { ranges: [{ start: 5, end: 5 }], activeIndex: 0 }, 'backspace')
if (decomposed.content !== 'café' || clusterDelete.content !== 'cafx') {
  throw new Error(`Backspace split a combining sequence: ${JSON.stringify([decomposed.content, clusterDelete.content])}`)
}

// An empty buffer has one line, so vertical and line-end cursors must not walk off it.
if (addEditorCursorOnAdjacentLine('', null, 0, 1) !== null
  || JSON.stringify(splitEditorSelectionIntoLineEndCursors('', { start: 0, end: 0 }).ranges) !== JSON.stringify([{ start: 0, end: 0 }])) {
  throw new Error('Empty-buffer cursor helpers drifted')
}

// Next-match search wraps past EOF back to the top of the buffer.
const wrapped = addEditorCursorAtNextMatch('abcabc', { ranges: [{ start: 3, end: 6 }], activeIndex: 0 }, { start: 3, end: 6 }, 6)
if (JSON.stringify(wrapped?.ranges) !== JSON.stringify([{ start: 3, end: 6 }, { start: 0, end: 3 }])) {
  throw new Error(`Next-match search did not wrap: ${JSON.stringify(wrapped)}`)
}
// Once every occurrence is taken, the state comes back unchanged rather than looping.
const exhausted = addEditorCursorAtNextMatch('ab ab', { ranges: [{ start: 0, end: 2 }, { start: 3, end: 5 }], activeIndex: 1 }, { start: 3, end: 5 }, 5)
if (exhausted?.ranges.length !== 2) throw new Error(`Exhausted next-match search grew the cursor set: ${JSON.stringify(exhausted)}`)

console.log('Editor multi-cursor surrogate/adjacency/degenerate-state smoke passed')
