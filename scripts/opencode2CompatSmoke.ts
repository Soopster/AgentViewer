// OpenCode 2 → OpenCode 1 translation (lib/opencode2Mapping.ts,
// lib/opencode2Events.ts). Every assertion here covers something that fails
// *silently*: a mistranslated tool renders as a generic card full of JSON, a
// part id that disagrees between the live stream and the history read renders
// the same answer twice, and a reasoning delta labelled as text prints the
// model's thinking into its reply. None of that throws, and none of it looks
// wrong in a screenshot.
//
// The fixtures are trimmed from a real `opencode serve` 2.0.8 session recorded
// against the live API, not hand-written from the spec.

import assert from 'node:assert/strict'
import {
  toV1MessageBundles,
  toV1Question,
  toV1Session,
  toV2FormAnswer,
  todosFromBundles,
  type V2FormInfo,
  type V2Message,
} from '../lib/opencode2Mapping'
import { OpenCode2EventTranslator, type V2Event } from '../lib/opencode2Events'
import { mapOpenCodeMessagesToSessionMessages, mapOpenCodeSessionToSession } from '../lib/opencodeMapper'
import { normalizeOpenCodeHarnessEvent } from '../lib/opencodeHarness'

const SESSION = 'ses_probe'
const ASSISTANT = 'msg_assistant'

const HISTORY: V2Message[] = [
  { id: 'msg_user', type: 'user', time: { created: 1_000 }, text: 'read the readme' },
  { id: 'msg_switch', type: 'model-switched', time: { created: 1_010 }, model: { id: 'mimo-v2.5-free', providerID: 'opencode' } },
  {
    id: ASSISTANT,
    type: 'assistant',
    time: { created: 1_100, completed: 1_900 },
    agent: 'build',
    model: { id: 'mimo-v2.5-free', providerID: 'opencode', variant: 'default' },
    tokens: { input: 9494, output: 24, reasoning: 53, cache: { read: 0, write: 0 } },
    finish: 'tool-calls',
    content: [
      { type: 'reasoning', text: 'thinking about it', time: { created: 1_110, completed: 1_200 } },
      {
        type: 'tool',
        id: 'call_shell',
        name: 'shell',
        state: { status: 'completed', input: { command: 'cat README.md' }, content: [{ type: 'text', text: 'hello from probe' }], metadata: { exit: 0 } },
        time: { created: 1_200, ran: 1_210, completed: 1_300 },
      },
      {
        type: 'tool',
        id: 'call_write',
        name: 'write',
        state: { status: 'completed', input: { path: 'NOTE.txt', content: 'ok' }, content: [{ type: 'text', text: 'Created file successfully: NOTE.txt' }] },
        time: { created: 1_400, completed: 1_500 },
      },
      { type: 'text', text: 'Done.' },
    ],
  },
  { id: 'msg_system', type: 'system', time: { created: 1_950 }, text: "Today's date is now: …" },
  { id: 'msg_synthetic', type: 'synthetic', time: { created: 1_960 }, text: '<shell id="sh_1" state="completed">done</shell>' },
  { id: 'msg_shell', type: 'shell', time: { created: 1_970, completed: 1_980 }, command: 'npm run build', status: 'exited', output: { output: 'built' } },
  { id: 'msg_idle', type: 'idle', time: { created: 1_990 }, outcome: 'succeeded' },
]

// ── History: the shapes the renderers read ──────────────────────────────────

const bundles = toV1MessageBundles(HISTORY, { sessionId: SESSION })
assert.deepEqual(
  bundles.map((bundle) => bundle.info.role),
  ['user', 'assistant', 'user', 'assistant'],
  'a v2 transcript maps to user/assistant bundles; idle, model-switched and system carry no turn of their own',
)

const assistant = bundles[1]!
assert.equal(assistant.info.id, ASSISTANT)
assert.equal((assistant.info as { modelID: string }).modelID, 'mimo-v2.5-free')
assert.deepEqual(assistant.parts.map((part) => part.type), ['reasoning', 'tool', 'tool', 'text'])

const [, shellPart, writePart] = assistant.parts as Array<{ type: string; tool?: string; state?: { input?: Record<string, unknown>; output?: string } }>
assert.equal(shellPart!.tool, 'bash', "v2's `shell` must render as v1's bash card")
assert.deepEqual(shellPart!.state!.input, { command: 'cat README.md' })
assert.equal(shellPart!.state!.output, 'hello from probe')
assert.equal(writePart!.tool, 'write')
assert.deepEqual(
  writePart!.state!.input,
  { filePath: 'NOTE.txt', content: 'ok' },
  "v2 renamed write/read/edit's file argument to `path`; the cards read `filePath`",
)

// A user message the server injected is marked synthetic, so it is not shown as
// something the user typed.
const syntheticBundle = bundles[2]!
assert.equal((syntheticBundle.parts[0] as { synthetic?: boolean }).synthetic, true)

// `!command` was an assistant turn holding a bash call in v1, and stays one.
const shellBundle = bundles[3]!
assert.equal(shellBundle.info.role, 'assistant')
assert.deepEqual(
  shellBundle.parts.map((part) => (part as { tool?: string }).tool),
  ['bash'],
)

// The existing mapper has to accept the result unchanged — this is the whole
// point of translating at the client boundary.
const mapped = mapOpenCodeMessagesToSessionMessages(bundles)
const toolNames = mapped.flatMap((message) =>
  Array.isArray(message.message.content)
    ? message.message.content.filter((block) => block.type === 'tool_use').map((block) => (block as { name: string }).name)
    : [])
assert.deepEqual(toolNames, ['bash', 'write', 'bash'])

// ── Sessions: what a 2.x server cannot do ───────────────────────────────────

const v2Session = toV1Session({
  id: SESSION,
  projectID: 'p',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  title: 'probe',
  location: { directory: '/repo' },
})
assert.equal(v2Session.directory, '/repo')
assert.equal(mapOpenCodeSessionToSession(v2Session, null).capabilities?.shareSession, false,
  'OpenCode 2 dropped sharing, so the reflect must not be offered for its sessions')
assert.equal(
  mapOpenCodeSessionToSession({ ...v2Session, version: '1.18.30' }, null).capabilities?.shareSession,
  true,
  'a 1.x session keeps sharing — the gate is per server, not per provider',
)

// ── The live stream ─────────────────────────────────────────────────────────

const translator = new OpenCode2EventTranslator()
const stream: V2Event[] = [
  { type: 'session.execution.started', created: 2_000, data: { sessionID: SESSION } },
  { type: 'session.inbox.delivered', created: 2_010, location: { directory: '/repo' }, data: { sessionID: SESSION, inboxID: 'msg_user2' } },
  { type: 'session.step.started', created: 2_020, location: { directory: '/repo' }, data: { sessionID: SESSION, agent: 'build', model: { id: 'mimo-v2.5-free', providerID: 'opencode' }, assistantMessageID: ASSISTANT, started: 2_020 } },
  { type: 'session.reasoning.started', created: 2_030, data: { sessionID: SESSION, assistantMessageID: ASSISTANT, ordinal: 0 } },
  { type: 'session.reasoning.delta', created: 2_040, data: { sessionID: SESSION, assistantMessageID: ASSISTANT, ordinal: 0, delta: 'thinking ' } },
  { type: 'session.tool.input.started', created: 2_050, data: { sessionID: SESSION, assistantMessageID: ASSISTANT, id: 'call_shell', name: 'shell' } },
  { type: 'session.tool.called', created: 2_060, data: { sessionID: SESSION, assistantMessageID: ASSISTANT, id: 'call_shell', input: { command: 'cat README.md' } } },
  { type: 'session.tool.success', created: 2_070, data: { sessionID: SESSION, assistantMessageID: ASSISTANT, id: 'call_shell', content: [{ type: 'text', text: 'hello from probe' }], metadata: { exit: 0 } } },
  { type: 'session.text.started', created: 2_080, data: { sessionID: SESSION, assistantMessageID: ASSISTANT, ordinal: 0 } },
  { type: 'session.text.delta', created: 2_090, data: { sessionID: SESSION, assistantMessageID: ASSISTANT, ordinal: 0, delta: 'Done.' } },
  { type: 'session.text.ended', created: 2_100, data: { sessionID: SESSION, assistantMessageID: ASSISTANT, ordinal: 0, text: 'Done.' } },
  { type: 'session.step.ended', created: 2_110, data: { sessionID: SESSION, assistantMessageID: ASSISTANT, finish: 'stop', cost: 0, tokens: { input: 9494, output: 24, reasoning: 53, cache: { read: 0, write: 0 } } } },
  { type: 'session.execution.succeeded', created: 2_120, data: { sessionID: SESSION } },
]
const translated = stream.flatMap((event) => translator.translate(event))
const types = translated.map((entry) => entry.payload.type)
assert.deepEqual(types, [
  'session.status',
  'message.updated',
  'message.updated',
  'message.part.updated',
  'message.part.delta',
  'message.part.updated',
  'message.part.updated',
  'message.part.updated',
  'message.part.updated',
  'message.part.delta',
  'message.part.updated',
  'message.updated',
  'session.status',
  'session.idle',
])

// Every frame must reach a subscriber filtering on the session's directory.
// Only some v2 events carry a location, so the rest are attributed from the
// session — a frame with the wrong directory is dropped by the harness and the
// turn looks frozen.
assert.ok(
  translated.slice(1).every((entry) => entry.directory === '/repo'),
  'events without a location of their own inherit the directory their session was last seen in',
)

// `message.part.delta` is a real OpenCode 1 event the SDK's `Event` union does
// not declare — the same reason lib/opencodeHarness.ts reads it through a cast.
const deltas = translated.filter((entry) => (entry.payload as { type: string }).type === 'message.part.delta')
  .map((entry) => (entry.payload as unknown as { properties: { field: string; delta: string; partID: string } }).properties)
assert.deepEqual(deltas.map((delta) => delta.field), ['reasoning', 'text'],
  'the thinking channel and the answer are separate fields; mixing them prints reasoning as the reply')

// The load-bearing agreement: the ids a live frame uses are the ids the history
// read derives for the same content. If these drift, a streamed card and the
// persisted one it settles into are two different cards.
const historyIds = new Set(assistant.parts.map((part) => part.id))
const streamedIds = translated
  .filter((entry) => entry.payload.type === 'message.part.updated')
  .map((entry) => (entry.payload as unknown as { properties: { part: { id: string } } }).properties.part.id)
for (const id of streamedIds) {
  assert.ok(historyIds.has(id), `streamed part id ${id} is not one the history read produces`)
}
assert.ok(deltas.every((delta) => historyIds.has(delta.partID)), 'a delta names the part it appends to')

const streamedTool = translated
  .map((entry) => entry.payload as unknown as { type: string; properties: { part?: { tool?: string; state?: { status: string; input?: Record<string, unknown> } } } })
  .filter((payload) => payload.properties.part?.tool)
assert.deepEqual(streamedTool.map((payload) => payload.properties.part!.state!.status), ['pending', 'running', 'completed'])
assert.deepEqual(streamedTool.map((payload) => payload.properties.part!.tool), ['bash', 'bash', 'bash'])
assert.deepEqual(streamedTool.at(-1)!.properties.part!.state!.input, { command: 'cat README.md' },
  'the input arrives with `tool.called` and must survive to the completed frame')

// A failed turn reports why *before* it reports that it ended: the send stream
// stops at the first of the two, and stopping on idle would drop the reason.
const failed = new OpenCode2EventTranslator().translate({
  type: 'session.execution.failed',
  created: 3_000,
  data: { sessionID: SESSION, error: { type: 'provider.quota', message: 'no credits' } },
})
assert.deepEqual(failed.map((entry) => entry.payload.type), ['session.error', 'session.status', 'session.idle'])
assert.match(
  JSON.stringify(failed[0]!.payload),
  /no credits/,
  'the failure reason has to reach the error frame',
)

// v2 has no todo API at all: the tool call is the only record, so the panel is
// fed from it.
const todoTranslator = new OpenCode2EventTranslator()
todoTranslator.translate({ type: 'session.step.started', created: 4_000, data: { sessionID: SESSION, assistantMessageID: 'msg_t', agent: 'build', started: 4_000 } })
todoTranslator.translate({ type: 'session.tool.input.started', created: 4_010, data: { sessionID: SESSION, assistantMessageID: 'msg_t', id: 'call_todo', name: 'todowrite' } })
const todoEvents = todoTranslator.translate({
  type: 'session.tool.called',
  created: 4_020,
  data: { sessionID: SESSION, assistantMessageID: 'msg_t', id: 'call_todo', input: { todos: [{ id: '1', content: 'do it', status: 'pending', priority: 'high' }] } },
})
assert.ok(todoEvents.some((entry) => entry.payload.type === 'todo.updated'))
assert.equal(
  todosFromBundles(toV1MessageBundles([{
    id: 'msg_t',
    type: 'assistant',
    time: { created: 4_000 },
    content: [{ type: 'tool', id: 'call_todo', name: 'todowrite', state: { status: 'completed', input: { todos: [{ id: '1', content: 'do it', status: 'pending', priority: 'high' }] }, content: [] }, time: { created: 4_000 } }],
  }], { sessionId: SESSION })).length,
  1,
  'a cold read finds the same todo list the live event carried',
)

// ── Permissions and questions ───────────────────────────────────────────────

const permission = new OpenCode2EventTranslator().translate({
  type: 'permission.asked',
  created: 5_000,
  location: { directory: '/repo' },
  data: { id: 'perm_1', sessionID: SESSION, action: 'edit', resources: ['/repo/file.ts'], save: ['edit'], source: { type: 'tool', messageID: ASSISTANT, id: 'call_edit' } },
})[0]!
// The harness normalizes a `permission.asked` into the shape the shared
// permission UI consumes; a mistranslation here shows an unanswerable card.
const normalized = normalizeOpenCodeHarnessEvent(permission.payload) as unknown as {
  type: string
  properties: { id: string; type: string; sessionID: string; messageID: string; callID?: string; pattern?: unknown }
}
assert.equal(normalized.type, 'permission.updated')
assert.equal(normalized.properties.id, 'perm_1')
assert.equal(normalized.properties.type, 'edit')
assert.equal(normalized.properties.messageID, ASSISTANT)
assert.equal(normalized.properties.callID, 'call_edit')
assert.deepEqual(normalized.properties.pattern, ['/repo/file.ts'])

const form: V2FormInfo = {
  id: 'form_1',
  sessionID: SESSION,
  title: 'Pick one',
  fields: [
    { key: 'approach', title: 'Approach', description: 'Which approach should I take?', type: 'string', options: [{ value: 'a', label: 'Rewrite' }, { value: 'b', label: 'Patch' }] },
    { key: 'areas', title: 'Areas', type: 'multiselect', options: [{ value: 'ui', label: 'UI' }, { value: 'api', label: 'API' }] },
    { key: 'notes', title: 'Notes', type: 'string' },
  ],
}
const question = toV1Question(form)
assert.equal(question.id, 'form_1')
assert.deepEqual(question.questions.map((entry) => entry.header), ['Approach', 'Areas', 'Notes'])
assert.deepEqual(question.questions[0]!.options.map((option) => option.label), ['Rewrite', 'Patch'])
assert.equal(question.questions[1]!.multiple, true)
assert.equal(question.questions[2]!.custom, true, 'a field with no options is answered as free text')

// The answer travels back as the labels the user saw; the server stores values.
assert.deepEqual(
  toV2FormAnswer(form, [['Patch'], ['UI', 'API'], ['careful please']]),
  { approach: 'b', areas: ['ui', 'api'], notes: 'careful please' },
  'a chosen label must be resolved to its option value, which is usually a different string',
)

console.log('opencode2 compat smoke passed')
