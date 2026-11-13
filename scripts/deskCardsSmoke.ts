// The Web desk's stories: a raw transcript as the cards the desk model reads,
// so CN (session news) and DES (turn and tool counts) work without TUI cards.
import assert from 'node:assert/strict'
import { buildDeskTable, deskCardsFromMessages } from '../plugins/desk/tui/deskModel'
import type { Session, SessionMessage } from '../lib/types'

const msg = (uuid: string, type: 'user' | 'assistant', content: unknown, at: string): SessionMessage => ({ type, uuid, session_id: 's', parent_tool_use_id: null, timestamp: at, message: { role: type, content } } as SessionMessage)
const messages = [
  msg('u1', 'user', 'fix   the\nlogin bug', '2026-11-14T09:00:00Z'),
  msg('a1', 'assistant', [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }, { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'src/login.ts' } }], '2026-11-14T09:00:05Z'),
  msg('r1', 'user', [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }], '2026-11-14T09:00:09Z'),
]
const cards = deskCardsFromMessages(messages)
assert.deepEqual(cards.map(card => [card.role, card.category, card.compactSummary]), [
  ['user', 'conversation', 'fix the login bug'],
  ['assistant', 'conversation', 'Looking.'],
  ['assistant', 'technical', 'Bash npm test'],
  ['assistant', 'diff', 'Edit src/login.ts'],
], 'prompts and replies are conversation, tool calls technical, edits diffs; a tool result is no story')
const session = { sessionId: 's', provider: 'claude', summary: 'login', lastModified: Date.parse('2026-11-14T09:00:09Z') } as Session
const input = { sessions: [session], activity: new Map(), upticks: new Set<string>(), now: Date.parse('2026-11-14T10:00:00Z'), alerts: [], loaded: session, loadedCards: cards, loadedContext: null, loadedModel: null, loadedMessageCount: 3, chartWidth: 40, chartHeight: 6 }
const news = buildDeskTable('CN', input)!
assert.equal(news.rows.length, 4)
assert.equal(news.rows[0]!.cells[2]!.text, 'Edit src/login.ts', 'newest story first')
const description = buildDeskTable('DES', input)!
const field = (name: string) => description.rows.find(row => row.cells[0]?.text.includes(name))?.cells[1]?.text
assert.equal(field('TOOL CARDS'), '2', `DES counts tool calls: ${JSON.stringify(description.rows.map(row => row.cells.map(cell => cell.text)))}`)
console.log('Desk cards: a raw transcript feeds CN stories and DES counts.')
console.log('Desk cards smoke: PASS')
