// A coloured Bash result keeps its colours in the TUI: the card line's text stays
// the plain characters (layout, search and copy are unchanged) and carries runs
// that draw in the current theme's palette.
import assert from 'node:assert/strict'
import { buildThreadedMessages } from '../lib/threading'
import type { SessionMessage } from '../lib/types'
import { blocksNeedTuiAnsi, ensureTuiAnsiHighlighter, formatTranscriptCards } from '../tui/format'
import { ansiRunSegments } from '../tui/opentui/app/ansiSegments'
import { getThemePalette } from '../tui/theme'

const OUTPUT = '\x1b[31mFAIL\x1b[0m src/a.test.ts\n\x1b[1;32mPASS\x1b[0m\tsrc/b.test.ts\nplain line'
const messages = (output: string): SessionMessage[] => [
  { type: 'assistant', uuid: 'a', session_id: 's', parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } } as unknown as SessionMessage,
  { type: 'user', uuid: 'u', session_id: 's', parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: output }] } } as unknown as SessionMessage,
]

const threaded = buildThreadedMessages(messages(OUTPUT))
assert.ok(threaded.some(message => blocksNeedTuiAnsi(message.blocks)), 'coloured output is detected')
assert.ok(!buildThreadedMessages(messages('plain')).some(message => blocksNeedTuiAnsi(message.blocks)), 'plain output is not')

const find = (cards: ReturnType<typeof formatTranscriptCards>, text: string) =>
  cards.flatMap(card => card.expandedLines).find(entry => entry.text === text)

// Before the highlighter loads the lines are plain, exactly as they were.
const before = formatTranscriptCards(threaded)
assert.equal(find(before, 'FAIL src/a.test.ts')?.runs, undefined)

await ensureTuiAnsiHighlighter()
const cards = formatTranscriptCards(threaded)
const fail = find(cards, 'FAIL src/a.test.ts')
const pass = find(cards, 'PASS  src/b.test.ts')
assert.ok(fail?.runs, `FAIL line has runs:\n${cards.flatMap(c => c.expandedLines).map(l => l.text).join('\n')}`)
assert.ok(pass?.runs, 'tab-bearing line has runs')
assert.equal(find(cards, 'plain line')?.runs, undefined, 'unstyled lines carry none')
assert.ok(!cards.some(card => card.expandedLines.some(entry => entry.text.includes('\x1b'))), 'no escape in any text')

const theme = getThemePalette('dark')
const failSegments = ansiRunSegments(fail!.runs!, theme)
assert.equal(failSegments.map(segment => segment.text).join(''), 'FAIL src/a.test.ts')
assert.equal(failSegments[0]!.fg, theme.red, 'ANSI red takes the theme red')
assert.equal(failSegments[1]!.fg, theme.text, 'default colour takes the theme text')
const passSegments = ansiRunSegments(pass!.runs!, theme)
assert.equal(passSegments[0]!.fg, theme.green)
assert.ok(passSegments[0]!.attributes, 'bold survives')
assert.equal(passSegments.map(segment => segment.text).join(''), 'PASS  src/b.test.ts', 'tabs are laid out as spaces')
assert.notEqual(ansiRunSegments(fail!.runs!, getThemePalette('light'))[0]!.fg, theme.red, 'a different theme draws its own red')
console.log('TUI ANSI output smoke passed')
