// Surface windows among session panes: the slot model behind every move. A
// wrong merge here shows a session twice, drops one, or moves a surface when a
// plan only reordered the sessions — all of which still render plausibly.
import assert from 'node:assert/strict'
import { fitWindows, moveWindowBeside, orderWindows, surfaceWindowKey, swapWindowSlots } from './windowOrder'

const T = surfaceWindowKey('terminal')
const D = surfaceWindowKey('diff')

assert.deepEqual(orderWindows([], ['a', 'b'], ['terminal']), ['a', 'b', T], 'with no order, sessions then surfaces')
assert.deepEqual(orderWindows(['a', T, 'b'], ['a', 'b'], ['terminal']), ['a', T, 'b'], 'a remembered slot keeps the surface between sessions')
// A plan reordered the sessions: the surface stays in its slot, the sessions fill theirs in the new order.
assert.deepEqual(orderWindows(['a', T, 'b'], ['b', 'a'], ['terminal']), ['b', T, 'a'])
// A new session pinned at the front by an edge drop: still one surface slot, kept where it was.
assert.deepEqual(orderWindows(['a', T, 'b'], ['c', 'a', 'b'], ['terminal']), ['c', T, 'a', 'b'])
// A session no longer pinned frees its slot; one never mentioned is appended.
assert.deepEqual(orderWindows(['a', T, 'b'], ['b'], ['terminal', 'diff']), [T, 'b', D], 'the surviving session keeps its own slot, after the surface')
assert.deepEqual(new Set(orderWindows([T, 'x', 'y', D], ['p', 'q', 'r'], ['terminal', 'diff'])).size, 5, 'nothing shown twice')
console.log('Surfaces keep their slots; sessions fill theirs in pin order.')

assert.deepEqual(fitWindows(['a', T, 'b', 'c'], 3), ['a', T, 'b'], 'a session goes first')
assert.deepEqual(fitWindows(['a', T, 'b'], 1), [T], 'every session goes before any surface')
assert.deepEqual(fitWindows([T, D], 1), [T], 'then surfaces, from the end')
// After a swap put the first pin last on screen, the last pin is still the one dropped.
assert.deepEqual(fitWindows([T, 'b', 'c', 'a'], 3, ['a', 'b', 'c']), [T, 'b', 'a'], 'sessions drop by pin order, not position')
console.log('Short of room, session panes are dropped before surface windows.')

assert.deepEqual(swapWindowSlots(['a', T, 'b'], 0, 1), [T, 'a', 'b'])
assert.deepEqual(orderWindows(swapWindowSlots(['a', T, 'b'], 0, 1), ['a', 'b'], ['terminal']), [T, 'a', 'b'], 'a swapped surface keeps its new slot')
assert.deepEqual(moveWindowBeside(['a', 'b', T], T, 'a', true), [T, 'a', 'b'])
assert.deepEqual(moveWindowBeside(['a', 'b', T], T, 'a', false), ['a', T, 'b'])
console.log('A surface swaps with, or moves beside, any session pane.')
console.log('Window order smoke passed')
