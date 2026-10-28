// Popover windows: which window a popover maps to, and what it is pinned to.
// A wrong answer here opens a second copy of a singleton (two editors writing
// one workspace's state) or shows the wrong session's numbers under a title
// that names another — both of which render plausibly.
import assert from 'node:assert/strict'
import { findPopoverWindow, isPopoverWindowKind, nextSurfaceId, pinFor, POPOVER_WINDOWS, readSurfaceMeta } from './popoverWindows'

assert.ok(isPopoverWindowKind('analytics') && isPopoverWindowKind('editor'))
assert.ok(!isPopoverWindowKind('terminal') && !isPopoverWindowKind('constructor'), 'only registry kinds, not object members')
assert.equal(POPOVER_WINDOWS.editor.keys, 'capture', 'the editor takes every key while focused')
assert.equal(POPOVER_WINDOWS.analytics.pin, 'session')

const meta = { analytics: { session: 'claude:a' }, 'analytics#2': { session: 'claude:b' } }
const surfaces = ['analytics', 'terminal', 'analytics#2', 'editor']
assert.equal(findPopoverWindow(surfaces, meta, 'analytics', { session: 'claude:b' }), 'analytics#2', 'one window per pinned session')
assert.equal(findPopoverWindow(surfaces, meta, 'analytics', { session: 'claude:c' }), null, 'a new session gets a new window')
assert.equal(findPopoverWindow(surfaces, meta, 'editor', {}), 'editor', 'a single kind has its one window')
assert.equal(findPopoverWindow(['terminal'], {}, 'daily-summary', {}), null)
console.log('A popover maps to its window: one per pin, one in all for a singleton.')

assert.equal(nextSurfaceId('analytics', new Set(surfaces)), 'analytics#3')
assert.equal(nextSurfaceId('daily-summary', new Set(surfaces)), 'daily-summary')
assert.deepEqual(pinFor('analytics', { session: 'claude:x', path: null }), { session: 'claude:x' })
assert.deepEqual(pinFor('editor', { session: 'claude:x', path: '/a' }), {}, 'an unpinned kind ignores the reader')
assert.deepEqual(pinFor('analytics', { session: null, path: null }), {}, 'no reader session, no pin')
assert.deepEqual(readSurfaceMeta({ analytics: { session: 'claude:a', extra: 1 }, bad: 'x', empty: {}, arr: [] }), { analytics: { session: 'claude:a' } })
assert.deepEqual(readSurfaceMeta(null), {})
console.log('Pins come from the reader, and persisted pins are validated.')
console.log('Popover windows smoke passed')
