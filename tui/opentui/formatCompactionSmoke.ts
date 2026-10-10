import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildThreadedMessages } from '../../lib/threading'
import type { SessionMessage } from '../../lib/types'
import { formatTranscriptCards } from '../format'

// Full serialized-card oracle captured before preview allocation changes.
// Includes hidden-line counts, whitespace/ANSI normalization, code extraction,
// tool previews and expanded output for every density.
const texts = [
  '', '   ', '\u001b[31m\u001b[0m', '\t\r\n', 'one',
  '  first  \n\n second\t\n\u001b[31mred\u001b[0m\n\u0000\nlast ',
  Array.from({ length: 300 }, (_, i) => `${i}: ${'long text '.repeat(40)}`).join('\n'),
  Array.from({ length: 30 }, (_, i) => `${i}\n\t\n\u001b[0m`).join('\n'),
  'intro\n```typescript\nconst a = 1\n```\nend',
]
const raw: SessionMessage[] = texts.flatMap((text, i): SessionMessage[] => [
  { uuid: `u${i}`, session_id: 'compaction', type: 'user', parent_tool_use_id: null, message: { role: 'user', content: text } },
  { uuid: `a${i}`, session_id: 'compaction', type: 'assistant', parent_tool_use_id: null, message: { role: 'assistant', content: [
    { type: 'thinking', thinking: text }, { type: 'text', text },
    { type: 'tool_use', id: `tool${i}`, name: 'Bash', input: { command: text } },
  ] } },
  { uuid: `r${i}`, session_id: 'compaction', type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: `tool${i}`, content: text },
  ] } },
])
const threaded = buildThreadedMessages(raw)
const result = ['dense', 'balanced', 'comfortable'].map((density) =>
  formatTranscriptCards(threaded, density as 'dense' | 'balanced' | 'comfortable'))
const digest = createHash('sha256').update(JSON.stringify(result)).digest('hex')
assert.equal(digest, '92ad26a5775c0413f2752f54497e1c0c5a4ebb6f58b195b9ffe3e62a92813927')
console.log('Transcript preview compaction: full card parity passed across all densities')
