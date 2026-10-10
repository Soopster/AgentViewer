// A coordinated agent's transcript is mostly text the Coordinator wrote: a
// standing brief, teammates' mail, and coord_* calls. Rendered raw it is a
// screen of instructions, a run of `[team message <uuid> from … kind=…]`
// headers, and kilobytes of JSON. This pins that it reads as who said what.
//
// The mail here is produced by the real `formatInbox`, not typed out: the
// parser and the formatter are two halves of one wire format, and a fixture
// would keep passing after the format moved.
import assert from 'node:assert/strict'
import { formatInbox, formatProtocolMailboxMessage, type ProtocolAgent, type ProtocolMessage } from '../lib/agentProtocol'
import { findCoordinatorRegions, parseCoordinatorMail } from '../lib/coordinatorTranscript'
import { buildThreadedMessages } from '../lib/threading'
import { formatMessageExpanded, formatTranscriptCards } from '../tui/format'
import type { SessionMessage } from '../lib/types'

const agent = (id: string, name: string) => ({ id, name }) as unknown as ProtocolAgent
const agentsById = new Map([agent('a-nova', 'nova'), agent('a-orion', 'orion'), agent('a-ada', 'Ada Lovelace')].map((entry) => [entry.id, entry]))
const mail = (id: string, from: string, body: string, extra: Partial<ProtocolMessage> = {}): ProtocolMessage => ({
  id, runId: 'chat-39c90b3b171b51f297e983ffaaf244a20473b7a2', fromAgentId: from, toAgentId: 'lead', body,
  kind: 'response', priority: 'normal', replyRequired: false, createdAt: '2026-10-10T00:00:00.000Z', ...extra,
})
const STANZA = 'The city sleeps behind its rows of glass.\nA laundromat glows like a mitten left on the curb.'
const INBOX = [
  mail('m-1', 'a-nova', 'task-1 started: Writing the opening stanza.', { kind: 'status', priority: 'status' as ProtocolMessage['priority'] }),
  mail('m-2', 'a-nova', STANZA),
  mail('m-3', 'a-orion', 'Strict or compatible parser?', { kind: 'question' as ProtocolMessage['kind'], replyRequired: true, priority: 'urgent' as ProtocolMessage['priority'], correlationId: 'c-1', inReplyTo: 'm-0' }),
  mail('m-4', 'a-ada', 'A reply with [brackets] and a line\n- [not a header] inside it'),
]

// ── the wire format round-trips ─────────────────────────────────────────────
{
  const parsed = parseCoordinatorMail(formatInbox(INBOX, agentsById))
  assert.equal(parsed.messages.length, INBOX.length, 'every message in a delivery is recovered')
  assert.deepEqual(parsed.messages.map((message) => message.id), INBOX.map((message) => message.id))
  assert.deepEqual(parsed.messages.map((message) => message.from), ['nova', 'nova', 'orion', 'Ada Lovelace'], 'a sender name with a space survives')
  assert.equal(parsed.messages[1]!.body, STANZA, 'a multi-line body is kept whole')
  assert.equal(parsed.messages[2]!.replyRequired, true)
  assert.equal(parsed.messages[2]!.urgent, true)
  assert.equal(parsed.messages[2]!.correlationId, 'c-1')
  assert.equal(parsed.messages[2]!.inReplyTo, 'm-0')
  assert.equal(parsed.messages[0]!.replyRequired, false)
  assert.equal(parsed.messages[3]!.body, INBOX[3]!.body, 'brackets in a body do not start a new message')
}

// ── a lead's delivered turn ─────────────────────────────────────────────────
const LEAD_BRIEF = 'You are the interactive Coordinator lead for run chat-39c90b3b171b51f297e983ffaaf244a20473b7a2. Use coord_delegate to assign bounded tasks. The binding is private; do not read or print it.'
const DELIVERED = `Teammates have responded. Review their results.\n\n${LEAD_BRIEF}\n--- Coordinator delivery 3bcbdcff ---\n${formatInbox(INBOX, agentsById)}\n--- end Coordinator delivery ---`
const TEAMMATE_BRIEF = 'Continue Coordinator run chat-39c90b3b171b51f297e983ffaaf244a20473b7a2 as lyra (teammate). You are ALREADY bound to this run — start with coord_status and act on the board and your inbox. Read and follow the coordinate-agents skill.'
const STEERED = formatProtocolMailboxMessage(mail('m-9', 'a-nova', 'Your stanza closes Small Lights.', { kind: 'request' as ProtocolMessage['kind'] }), 'lead')

const user = (uuid: string, text: string): SessionMessage => ({
  type: 'user', uuid, session_id: 'coord-smoke', parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'text', text }] },
}) as unknown as SessionMessage
const toolCall = (uuid: string, name: string, input: unknown, result: unknown): SessionMessage[] => [
  { type: 'assistant', uuid: `${uuid}-call`, session_id: 'coord-smoke', parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: uuid, name, input }] } } as unknown as SessionMessage,
  { type: 'user', uuid: `${uuid}-result`, session_id: 'coord-smoke', parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: uuid, content: result }] } } as unknown as SessionMessage,
]
const DIGEST = { accepted: true, runStatus: 'running', cursor: '618', phases: [{ title: 'Tasks', total: 3, pending: 0, active: 2, completed: 1, failed: 0 }] }

const threaded = buildThreadedMessages([
  user('lead', DELIVERED),
  user('teammate', TEAMMATE_BRIEF),
  user('steered', STEERED),
  user('plain', 'Use the Coordinator to write a poem about [team message] headers.'),
  // Codex: bare tool name, arguments under `value`, the MCP content array itself as the result.
  ...toolCall('codex', 'coord_complete_task', { value: { task_id: 'task-3', summary: 'Dawn thins the streetlamp.' } },
    JSON.stringify([{ type: 'inputText', text: JSON.stringify(DIGEST) }])),
  ...toolCall('inbox', 'coord_read_inbox', { value: { request_id: 'r-1' } },
    JSON.stringify([{ type: 'inputText', text: JSON.stringify({ messages: [], acknowledged: [], nextCursor: null }) }])),
  // A conversation that predates its binding calls the session client through the shell.
  ...toolCall('shell', 'Bash', { command: `/bin/zsh -lc "'/opt/bun/bin/bun.exe' '/repo/.agent-viewer-data/agent-coordination/session-bindings/client.mjs' '/repo/.agent-viewer-data/agent-coordination/session-bindings/ca205186.json' coord_status '{}'"` },
    JSON.stringify(DIGEST)),
  ...toolCall('mcp', 'mcp__agent-viewer__coord_status', {}, [{ type: 'text', text: JSON.stringify(DIGEST) }]),
  ...toolCall('other', 'Bash', { command: 'cat client.mjs binding.json' }, 'plain output'),
])
const blocksOf = (uuid: string) => threaded.find((message) => message.uuid === uuid)!.blocks
const cards = formatTranscriptCards(threaded)
const cardOf = (uuid: string) => cards[threaded.findIndex((message) => message.uuid === uuid)]!
const text = (uuid: string) => formatMessageExpanded(threaded, uuid).map((entry) => entry.text).join('\n')
const lines = (uuid: string) => cardOf(uuid).expandedLines.map((entry) => entry.text)

{
  const blocks = blocksOf('lead')
  assert.deepEqual(blocks.map((block) => block.type), ['text', 'coordinator_brief', 'coordinator_mail'], 'prompt, brief and mail are three blocks')
  assert.equal(blocks[0]!.type === 'text' && blocks[0].text, 'Teammates have responded. Review their results.', 'the prompt keeps its own words and nothing else')
  const rendered = lines('lead')
  assert(rendered.some((entry) => entry.includes('4 team messages') && entry.includes('nova, orion, Ada Lovelace')), `mail is counted and attributed:\n${rendered.join('\n')}`)
  assert(rendered.some((entry) => entry.startsWith('◂ nova · status') && entry.includes('task-1 started')), 'a status note rides its sender\'s row')
  assert(rendered.includes('  The city sleeps behind its rows of glass.'), 'a reply\'s lines read as its own lines')
  assert(rendered.some((entry) => entry.includes('orion · question') && entry.includes('urgent') && entry.includes('reply required')), 'what obliges the reader is on the row')
  const all = rendered.join('\n')
  assert(!all.includes('m-2') && !all.includes('kind=') && !all.includes('priority='), `routing detail stays out of the transcript:\n${all}`)
  assert(!all.includes('Use coord_delegate'), 'the standing brief is folded, not printed')
  assert(all.includes('Coordinator · lead'), 'and named, so the turn says a coordinated turn began')
  assert(!all.includes('--- Coordinator delivery') && !all.includes('--- end Coordinator delivery'), 'the envelope markers are not content')
  assert(text('lead').includes('The city sleeps'), 'the expanded reader carries the mail too')
  // An expanded card renders `markdownContent` INSTEAD of its lines; it is
  // built from the text blocks alone and would show the prompt without the mail.
  assert.equal(cardOf('lead').markdownContent, undefined, 'a coordinated turn is not handed to the markdown renderer')
}

{
  assert.deepEqual(blocksOf('teammate').map((block) => block.type), ['coordinator_brief'])
  const rendered = lines('teammate').join('\n')
  assert(rendered.includes('lyra (teammate)'), `a teammate's brief names who it is for:\n${rendered}`)
  assert(!rendered.includes('ALREADY bound'), 'and folds the instructions')
}

{
  const blocks = blocksOf('steered')
  assert.deepEqual(blocks.map((block) => block.type), ['coordinator_mail'], 'a message steered into a live turn is mail')
  const rendered = lines('steered').join('\n')
  assert(rendered.includes('lead · request') && rendered.includes('Your stanza closes Small Lights.'), rendered)
  assert(!rendered.includes('[team message'), 'without its header')
}

// Prose that merely mentions the words is prose.
assert.deepEqual(blocksOf('plain').map((block) => block.type), ['text'])
assert.deepEqual(findCoordinatorRegions('No coordination here.'), [])

// ── coord_* calls, however they were made ───────────────────────────────────
for (const uuid of ['codex-call', 'shell-call', 'mcp-call']) {
  const rendered = lines(uuid)
  assert(rendered[0]!.startsWith('coordinator '), `${uuid} is not shown as a Coordinator call:\n${rendered.join('\n')}`)
  assert(rendered.join('\n').includes('running · 3 tasks · 2 active · 1 done'), `${uuid} does not digest the run:\n${rendered.join('\n')}`)
  assert(!rendered.join('\n').includes('inputText') && !rendered.join('\n').includes('"cursor"'), `${uuid} leaks its JSON envelope:\n${rendered.join('\n')}`)
}
assert(lines('codex-call')[0]!.includes('task id task-3'), `Codex's arguments are under \`value\`:\n${lines('codex-call').join('\n')}`)
assert(lines('shell-call')[0] === 'coordinator status', `a shell call is named for the tool it ran, not the shell:\n${lines('shell-call').join('\n')}`)
assert(lines('inbox-call').join('\n').includes('inbox empty'), lines('inbox-call').join('\n'))
assert(lines('other-call')[0]!.startsWith('tool Bash'), 'an ordinary shell command is still a shell command')

console.log('Coordinator transcript smoke passed (mail round-trip, lead delivery, teammate brief, steered message, Codex / shell / MCP calls)')
