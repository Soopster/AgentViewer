// Tab groups and the floating window's geometry. A wrong merge here puts one
// window in two frames, or leaves a tab with no frame to show it in — both of
// which still render something plausible.
import assert from 'node:assert/strict'
import {
  addToStack, clampFloatingRect, defaultFloatingRect, liveStacks, removeFromStack,
  replaceWindowKey, stackNeighbour, stackOf, stackSuccessor,
} from './windowTabs'

assert.deepEqual(addToStack([], 'a', 'b'), [['a', 'b']], 'a first tab makes a stack')
assert.deepEqual(addToStack([['a', 'b']], 'a', 'c'), [['a', 'c', 'b']], 'a tab goes after the one it joined')
assert.deepEqual(addToStack([['a', 'b'], ['c', 'd']], 'c', 'b'), [['c', 'b', 'd']], 'a tab leaves its old stack, which dissolves at one')
assert.deepEqual(removeFromStack([['a', 'b', 'c']], 'b'), [['a', 'c']])
assert.deepEqual(stackOf([['a', 'b']], 'b'), ['a', 'b'])
assert.equal(stackNeighbour(['a', 'b', 'c'], 'a', -1), 'c', 'tabs wrap')
assert.equal(stackSuccessor(['a', 'b', 'c'], 'c'), 'b', 'the last tab hands its frame back')
assert.equal(stackSuccessor(['a', 'b', 'c'], 'a'), 'b')
console.log('Tabs join, leave and step through a stack.')

const laid = new Set(['a', 'x'])
assert.deepEqual(liveStacks([['a', 'b']], () => true, (key) => laid.has(key)), [['a', 'b']])
assert.deepEqual(liveStacks([['b', 'c']], () => true, (key) => laid.has(key)), [], 'a stack with no frame is dropped')
assert.deepEqual(liveStacks([['a', 'x', 'b']], () => true, (key) => laid.has(key)), [['a', 'b']], 'a second laid-out member is a window of its own')
assert.deepEqual(liveStacks([['a', 'gone']], (key) => key !== 'gone', (key) => laid.has(key)), [], 'a stack down to one live member dissolves')
assert.deepEqual(liveStacks([['a', 'b'], ['x', 'b']], () => true, (key) => laid.has(key)), [['a', 'b']], 'a key is in one stack only')
console.log('Only stacks with exactly one frame survive.')

assert.deepEqual(replaceWindowKey(['a', 'T', 'c'], 'T', 'b'), ['a', 'b', 'c'])
assert.deepEqual(replaceWindowKey(['a', 'b', 'c'], 'a', 'c'), ['c', 'b'], 'no window ends up twice')

const area = { width: 100, height: 40 }
const rect = defaultFloatingRect(area)
assert.deepEqual(rect, { x: 13, y: 5, width: 75, height: 30 })
assert.deepEqual(clampFloatingRect({ x: 90, y: 38, width: 75, height: 30 }, area), { x: 25, y: 10, width: 75, height: 30 }, 'dragged off the edge, it stays whole on screen')
assert.deepEqual(clampFloatingRect({ x: 0, y: 0, width: 3, height: 1 }, area), { x: 0, y: 0, width: 24, height: 6 }, 'resized below its minimum, it keeps a grabbable size')
assert.deepEqual(clampFloatingRect({ x: 0, y: 0, width: 75, height: 30 }, { width: 20, height: 5 }), { x: 0, y: 0, width: 20, height: 5 }, 'a tiny area holds it at the area')
console.log('A floating window opens centred and stays on screen at a grabbable size.')
console.log('Window tabs smoke passed')
