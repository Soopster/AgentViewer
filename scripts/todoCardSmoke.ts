// TodoWrite transcript rendering: the plan the agent is following is the single
// most useful thing on screen during a turn, so the TUI must show the items —
// not just tally them — the way the web TodoWriteCard and the native CLI do.
import assert from 'node:assert/strict'
import { buildThreadedMessages } from '../lib/threading'
import { formatMessageExpanded, formatTranscriptCards } from '../tui/format'
import type { SessionMessage } from '../lib/types'

const TODOS = [
  { content: 'Read the failing test', status: 'completed', activeForm: 'Reading the failing test' },
  { content: 'Fix the off-by-one in the parser', status: 'in_progress', activeForm: 'Fixing the off-by-one in the parser' },
  { content: 'Run the suite', status: 'pending', activeForm: 'Running the suite' },
]

const messages = (todos: unknown[]): SessionMessage[] => [
  {
    type: 'assistant',
    uuid: 'todo-call',
    session_id: 'todo-smoke',
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_todo', name: 'TodoWrite', input: { todos } }],
    },
  } as unknown as SessionMessage,
  {
    type: 'user',
    uuid: 'todo-result',
    session_id: 'todo-smoke',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_todo', content: 'Todos have been modified successfully.' }],
    },
  } as unknown as SessionMessage,
]

const threaded = buildThreadedMessages(messages(TODOS))
const expanded = formatMessageExpanded(threaded, 'todo-call').map((entry) => entry.text)

// Every todo appears, with the status glyph the web card uses.
assert.ok(expanded.some((text) => text.includes('✓ Read the failing test')), `completed todo missing:\n${expanded.join('\n')}`)
assert.ok(expanded.some((text) => text.includes('◐ Fix the off-by-one in the parser')), `active todo missing:\n${expanded.join('\n')}`)
assert.ok(expanded.some((text) => text.includes('○ Run the suite')), `pending todo missing:\n${expanded.join('\n')}`)

// Completed items read as done, active as foreground, pending as secondary —
// the tone carries the status once the glyph scrolls past.
const toneOf = (needle: string) =>
  formatMessageExpanded(threaded, 'todo-call').find((entry) => entry.text.includes(needle))?.tone
assert.equal(toneOf('Read the failing test'), 'dim')
assert.equal(toneOf('Fix the off-by-one'), 'default')
assert.equal(toneOf('Run the suite'), 'muted')

// The collapsed card stays two lines like every other tool preview, but names
// the todo actually in flight rather than only tallying statuses.
const cards = formatTranscriptCards(threaded)
const preview = cards.flatMap((card) => card.lines.map((entry) => entry.text))
assert.ok(preview.some((text) => text.includes('tool TodoWrite: 3 todos')), `preview header missing:\n${preview.join('\n')}`)
assert.ok(
  preview.some((text) => text.includes('◐ Fixing the off-by-one in the parser') && text.includes('1 done')),
  `preview did not name the in-flight todo:\n${preview.join('\n')}`,
)

// With nothing in progress the preview falls back to the tally.
const doneOnly = buildThreadedMessages(messages([
  { content: 'Read the failing test', status: 'completed' },
  { content: 'Run the suite', status: 'pending' },
]))
const donePreview = formatTranscriptCards(doneOnly).flatMap((card) => card.lines.map((entry) => entry.text))
assert.ok(donePreview.some((text) => text.trim() === '1 done · 1 pending'), `tally fallback missing:\n${donePreview.join('\n')}`)

// Malformed todos must not crash the transcript or render "undefined".
const malformed = buildThreadedMessages(messages([null, 'nope', { status: 'in_progress' }]))
const malformedLines = [
  ...formatMessageExpanded(malformed, 'todo-call').map((entry) => entry.text),
  ...formatTranscriptCards(malformed).flatMap((card) => card.lines.map((entry) => entry.text)),
]
assert.ok(malformedLines.length > 0)
assert.ok(!malformedLines.some((text) => /undefined|null|\[object/.test(text)), `malformed todos leaked:\n${malformedLines.join('\n')}`)
assert.ok(malformedLines.some((text) => text.includes('(untitled todo)')), `untitled placeholder missing:\n${malformedLines.join('\n')}`)

console.log('TodoWrite transcript card smoke passed')
