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
