// The strip reads the newest TodoWrite call (each restates the whole list), in a
// tool group or alone, and says nothing once the plan is finished.
import assert from 'node:assert/strict'
import { latestTaskStrip, taskStripRows } from './app/todoStripModel'
import type { TuiTranscriptCard } from '../format'

const todoCard = (key: string, items: Array<[string, string]>) => ({
  key, role: 'assistant', category: 'technical',
  lines: [{ text: `tool TodoWrite: ${items.length} todos`, tone: 'tool' }],
  expandedLines: [{ text: `tool TodoWrite: ${items.length} todos`, tone: 'tool' }, ...items.map(([glyph, text]) => ({ text: `  ${glyph} ${text}`, tone: 'muted' }))],
}) as unknown as TuiTranscriptCard

const old = todoCard('old', [['✓', 'a'], ['○', 'b']])
const current = todoCard('new', [['✓', 'a'], ['✓', 'b'], ['◐', 'Fix surface resize'], ['○', 'd']])
const group = { key: 'g', role: 'assistant', category: 'technical', lines: [{ text: 'group', tone: 'tool' }], expandedLines: [], agentToolCards: [current] } as unknown as TuiTranscriptCard

const state = latestTaskStrip([old, group])
assert.deepEqual([state?.done, state?.total, state?.active], [2, 4, 'Fix surface resize'], 'newest call wins, found inside a group')
assert.equal(latestTaskStrip([]), null)
assert.equal(latestTaskStrip([todoCard('x', [['✓', 'a'], ['✓', 'b']])]), null, 'a finished plan takes no row')
assert.equal(taskStripRows(state, false), 1)
assert.equal(taskStripRows(state, true), 5)
assert.equal(taskStripRows(null, true), 0)
console.log('Task strip smoke passed (newest list, groups, finished plan, row budget)')
