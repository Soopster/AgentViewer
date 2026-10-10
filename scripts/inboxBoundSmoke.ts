import assert from 'node:assert/strict'
import type { ProtocolAgent, ProtocolMessage } from '../lib/agentProtocol'
import { formatInbox, MAX_INBOX_MESSAGE_CHARS, MAX_INBOX_TOTAL_CHARS } from '../lib/agentProtocol'

const agents = new Map<string, ProtocolAgent>([['a', { id: 'a', name: 'ada' } as ProtocolAgent], ['b', { id: 'b', name: 'bo' } as ProtocolAgent]])
const msg = (id: string, body: string, extra: Partial<ProtocolMessage> = {}): ProtocolMessage => ({
  id, runId: 'r', fromAgentId: id.startsWith('b') ? 'b' : 'a', toAgentId: 'lead', body, kind: 'request', priority: 'normal', replyRequired: false, createdAt: '', ...extra,
}) as ProtocolMessage

// Small mail is untouched, tags included.
assert.equal(formatInbox([msg('a1', 'hello'), msg('b1', 'urgent!', { priority: 'urgent', replyRequired: true })], agents),
  '- from ada: hello\n- from bo [URGENT, reply-required]: urgent!')
assert.equal(formatInbox([], agents), '(empty)')

// One huge message is cut, says how much, and names where the rest lives.
const big = formatInbox([msg('a1', 'x'.repeat(50_000))], agents)
assert.ok(big.length < MAX_INBOX_MESSAGE_CHARS + 300)
assert.match(big, /44000 more characters not shown; message a1 is in the run history/)

// Many messages: the delivery stays bounded, nothing vanishes, and mail that needs an answer keeps its full text.
const flood = [
  ...Array.from({ length: 40 }, (_, i) => msg(`a${i}`, `fyi ${i} ${'y'.repeat(3000)}`)),
  msg('b-ask', `please decide ${'z'.repeat(5000)}`, { replyRequired: true }),
]
const out = formatInbox(flood, agents)
assert.ok(out.length < MAX_INBOX_TOTAL_CHARS + 41 * 400 + 200, `bounded: ${out.length}`)
assert.equal(out.split('\n').filter((line) => line.startsWith('- from')).length, 41, 'every message is still listed')
assert.ok(out.includes('z'.repeat(5000)), 'the reply-required message is whole')
assert.match(out, /^\(\d+ further messages shortened to one line each/)
assert.ok(out.includes('fyi 0 '), 'earlier mail fits first')
assert.ok(!out.includes('y'.repeat(3000) + '\n- from ada: fyi 39 '), 'the tail was the part reduced')

// The board a prompt carries stays bounded on a long run, and never points a dependency at nothing.
{
  const { formatTaskBoard, BOARD_RECENT_FINISHED } = await import('../lib/agentProtocol')
  const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
    id, runId: 'r', title: `title ${id}`, prompt: '', status, targetRole: 'teammate', paths: [], blockedBy: [], seat: 'executor', verifyCommands: [],
    resultSummary: status === 'completed' ? `summary ${id} ${'s'.repeat(400)}` : undefined, createdAt: '', updatedAt: '', ...extra,
  }) as unknown as import('../lib/agentProtocol').ProtocolTask
  const finished = Array.from({ length: 300 }, (_, i) => task(`t${i}`, 'completed'))
  const board = formatTaskBoard([...finished, task('open1', 'in_progress'), task('open2', 'pending', { blockedBy: ['t3', 't299'] })])
  assert.ok(board.length < 20_000, `bounded: ${board.length}`)
  assert.match(board, /^- \(\d+ earlier finished tasks not listed: \d+ completed/)
  assert.ok(board.includes('- open1 [in_progress]') && board.includes('- open2 [pending]'), 'every open task is listed')
  assert.ok(board.includes('- t3 [completed]'), 'a finished task an open one depends on stays listed')
  assert.ok(!/- t3 \[completed\][^\n]*\n {2}result:/.test(board), '…without its result')
  assert.ok(board.includes(`summary t299 `), 'the newest finished work keeps its result')
  assert.ok(!board.includes('- t50 [completed]'), 'older finished work is only counted')
  assert.equal((board.match(/result:/g) ?? []).length, BOARD_RECENT_FINISHED, 'results only for the recent finished tasks')
  // Short boards are exactly as before.
  assert.equal(formatTaskBoard([task('t1', 'completed'), task('t2', 'pending')]).split('\n').length, 3)
  assert.equal(formatTaskBoard([]), '- (no tasks yet)')
}
console.log('inbox bound smoke: ok')
