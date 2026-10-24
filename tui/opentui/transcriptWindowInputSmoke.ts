import assert from 'node:assert/strict'
import { transcriptWindowCommand, isTranscriptLocalKey } from './transcriptWindowInput'
import type { ShortcutKeyEvent } from './shortcutKeys'

const key = (sequence: string, modifiers: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({ name: sequence, sequence, ctrl: false, meta: false, shift: false, option: false, ...modifiers })
const context = { selected: true, hasSession: true, searchMatches: true, fleetPaging: false,
  scrollback: false, pageRows: 21, cardPageRows: 16, primaryFrame: true, scrollStep: () => 3 }
const command = (sequence: string, options: Partial<typeof context> = {}, modifiers: Partial<ShortcutKeyEvent> = {}) => transcriptWindowCommand(key(sequence, modifiers), { ...context, ...options })
assert.deepEqual(command('j'), { type: 'moveCursor', delta: 1 })
assert.deepEqual(command('j', { scrollback: true }), { type: 'scroll', rows: 3 })
assert.deepEqual(command('u', {}, { ctrl: true }), { type: 'moveCursor', delta: -16 })
assert.deepEqual(command('u', { scrollback: true }, { ctrl: true }), { type: 'scroll', rows: -11 })
assert.deepEqual(command('u'), { type: 'action', action: 'unread' })
assert.deepEqual(command('return', { scrollback: true }), { type: 'action', action: 'toggleAll' })
assert.deepEqual(command('return'), { type: 'action', action: 'open' })
assert.deepEqual(command('G'), { type: 'edge', edge: 'last' })
assert.deepEqual(command('Q'), { type: 'action', action: 'reply' })
assert.equal(command('c', {}, { meta: true }), null, 'Meta shortcuts stay global')
assert.equal(command('e', {}, { ctrl: true }), null, 'Kitty Ctrl+letter is not a fold command')
assert.deepEqual(command('c', {}, { ctrl: true }), { type: 'action', action: 'interrupt' })
assert.deepEqual(command('n'), { type: 'searchStep', direction: 1 })
assert.equal(command('N', { searchMatches: false }), null, 'new-session shortcut stays global without search matches')
assert.deepEqual(command('{'), { type: 'technicalJump', direction: -1 })
assert.equal(command('{', { fleetPaging: true }), null, 'fleet paging precedes transcript jumping')
assert.equal(command('right'), null, 'primary frame owns the global tab strip')
assert.deepEqual(command('right', { primaryFrame: false }), { type: 'stripStep', direction: 1 })
assert.deepEqual(command('a', {}, { ctrl: true, shift: true }), { type: 'action', action: 'coordination' })
assert.equal(isTranscriptLocalKey(key('n'), 'n'), false)
assert.equal(isTranscriptLocalKey(key('j', { meta: true }), 'j'), false)
console.log('Transcript window input passed: cursor/scrollback ownership, modifiers, search/fleet precedence, tabs and interrupt')
