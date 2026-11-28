import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { AskUserQuestionPicker } from '../components/message-view/AskUserQuestionPicker'
import MessageItem from '../components/MessageItem'
import { claudeCacheUsageItems, claudeContextBreakdown } from '../lib/claudeSessionPolicy'
import { claudeQuestionOutcomeCapability } from '../lib/claudeQuestionOutcomes'
import { claudeQuestionDecision, createClaudePermissionBridge, runAction } from '../lib/extensions/providers/claude/runtime'
import { pendingClaudePermissions, pendingClaudePermissionKey } from '../lib/extensions/providers/claude/helpers'
import { extractClaudePermission } from '../lib/permissions'
import { extractClaudeStreamToolResults, normalizeClaudeHistoryMessages } from '../lib/claudeMapper'
import { buildThreadedMessages } from '../lib/threading'
import { formatTranscriptCards } from '../tui/format'
import { buildCoordinatorCopilotTools } from '../lib/agentCoordinationSdkTools'
import { coordinatorToolSpecsForRole } from '../lib/coordinatorToolContract.mjs'
import { createClaudeArtifactStore } from '../lib/claudeArtifactStore'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const context = claudeContextBreakdown({ maxTokens: 2000, categories: [
  { id: 'mcp_instructions', name: 'Localized instructions', tokens: 300, kind: 'used' },
  { id: 'future_category', name: 'Future label', tokens: 100, kind: 'used' },
  { id: 'messages', name: 'Misleading label', tokens: 500, kind: 'free' },
], mcpInstructions: [{ serverName: 'large', tokens: 250 }, { serverName: 'small', tokens: 50 }] })
assert.equal(context.usedTokens, 400, 'Estimated server shares never inflate the category total')
assert.match(context.items.join('\n'), /MCP instructions · 300/)
assert.match(context.items.join('\n'), /Future label/)
assert.match(context.items.join('\n'), /estimated shares; already counted/)
assert.match(context.items.join('\n'), /large · 250/)
assert.ok(context.items.indexOf('free') < context.items.indexOf('  Messages · 500 · 25.0%'), 'ID does not override kind')
const cache = claudeCacheUsageItems({ model: {
  cacheReadInputTokens: 1000, cacheCreationInputTokens: 1000,
  cacheCreationEphemeral5mInputTokens: 300, cacheCreationEphemeral1hInputTokens: 500,
}, older: { cacheCreationInputTokens: 100 } }).join('\n')
assert.match(cache, /cache writes · 1.0k/)
assert.match(cache, /5-minute writes · 300/)
assert.match(cache, /1-hour writes · 500/)
assert.match(cache, /lifetime unknown · 200/)
assert.match(cache, /1-hour writes · not reported/)
assert.deepEqual(claudeCacheUsageItems(null), [])

for (const role of ['lead', 'teammate'] as const) {
  const tools = buildCoordinatorCopilotTools({ runId: 'run', agentId: 'agent', token: 'fixture', role })
  assert.deepEqual(tools.map(tool => tool.name), coordinatorToolSpecsForRole(role).map(tool => tool.name))
  assert.ok(tools.every(tool => tool.namespace?.name === 'agent_viewer_coordinator' && tool.skipPermission))
  for (const name of ['coord_status', 'coord_read_inbox', 'coord_complete_task']) {
    assert.equal(tools.find(tool => tool.name === name)?.defer, 'never', `${name} must work before discovery`)
  }
  assert.ok(tools.some(tool => tool.defer === 'auto'))
  console.log(JSON.stringify({ role, tools: tools.length, eager: tools.filter(tool => tool.defer === 'never').length, deferred: tools.filter(tool => tool.defer === 'auto').length }))
}

const questions = [{ question: 'Which approach?', options: [{ label: 'First' }, { label: 'Second' }] }]
const input = { questions }
assert.equal(claudeQuestionOutcomeCapability({ type: 'system', subtype: 'init', capabilities: ['ask_user_question_unanswered_v1'] }), true)
assert.equal(claudeQuestionOutcomeCapability({ type: 'system', subtype: 'init' }), false)
assert.equal(claudeQuestionOutcomeCapability({ type: 'result' }), undefined)
const unusualQuestion = claudeQuestionDecision({ input: { questions: [{ question: '__proto__' }] }, supportsQuestionOutcomes: true }, { answers: {}, unanswered: 'skipped' })
assert.equal(unusualQuestion.behavior, 'allow')
if (unusualQuestion.behavior === 'allow') assert.equal((unusualQuestion.updatedInput?.answers as Record<string, string>)['__proto__'], 'User skipped this question.')
const frames: string[] = []
let controller!: ReadableStreamDefaultController<Uint8Array>
const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
const reader = stream.getReader()
let advertised = false
const bridge = createClaudePermissionBridge('fixture', controller, new TextEncoder(), new Set(), () => advertised)
for (const supported of [false, true]) {
  advertised = supported
  const waiting = bridge('AskUserQuestion', input, { requestId: 'ask', toolUseID: 'ask', signal: new AbortController().signal })
  frames.push(new TextDecoder().decode((await reader.read()).value))
  const pending = pendingClaudePermissions.get(pendingClaudePermissionKey('fixture', 'ask'))!
  assert.equal(pending.supportsQuestionOutcomes, supported)
  const event = JSON.parse(frames.at(-1)!.slice('data: '.length))
  const permission = extractClaudePermission(event)!
  assert.equal(permission.supportsQuestionOutcomes, supported)
  const picker = renderToStaticMarkup(<AskUserQuestionPicker permission={permission} busy={false} onSubmit={() => {}} onCancel={() => {}} />)
  assert.equal(picker.includes('Reply in chat'), supported)
  for (const unanswered of ['skipped', 'replied_in_chat', 'dismissed'] as const) {
    const decision = claudeQuestionDecision(pending, { answers: {}, unanswered, response: unanswered === 'replied_in_chat' ? 'Use the simpler option.' : undefined })
    assert.equal(decision.behavior, 'allow')
    if (decision.behavior !== 'allow') throw new Error('Expected answer decision')
    const updated = decision.updatedInput!
    if (!supported) {
      assert.equal(updated.annotations, undefined)
      continue
    }
    assert.equal((updated.annotations as Record<string, { unanswered: string }>)['Which approach?'].unanswered, unanswered)
    assert.ok((updated.answers as Record<string, string>)['Which approach?'], 'The model gets text, not invisible annotations alone')
    const result = { type: 'tool_result', tool_use_id: 'ask', content: 'User responded.' }
    const raw = { type: 'user', uuid: 'result', session_id: 'fixture', message: { role: 'user', content: [result] }, tool_use_result: { ...updated, questions } }
    const live = extractClaudeStreamToolResults(raw)[0]
    const history = normalizeClaudeHistoryMessages([
      { type: 'assistant', uuid: 'call', session_id: 'fixture', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'ask', name: 'AskUserQuestion', input }] } }, raw,
    ])
    const threaded = buildThreadedMessages(history)
    assert.deepEqual((history[1].message as { content: Array<{ questionResult?: unknown }> }).content[0].questionResult, live.questionResult, 'Live and history retain the same UI-only annotations')
    const label = unanswered === 'replied_in_chat' ? 'replied in chat' : unanswered
    assert.match(JSON.stringify(formatTranscriptCards(threaded)), new RegExp(label))
    assert.match(renderToStaticMarkup(<MessageItem message={threaded[0]} />), new RegExp(label))
  }
  const sanitized = claudeQuestionDecision(pending, { answers: {}, annotations: { 'Which approach?': { unanswered: 'future' as never, notes: 'Keep this note' } } })
  if (sanitized.behavior === 'allow') assert.deepEqual(sanitized.updatedInput?.annotations, { 'Which approach?': { notes: 'Keep this note' } })
  pending.resolve(claudeQuestionDecision(pending, { answers: { 'Which approach?': 'First' } }))
  await waiting
  await reader.read() // permission.completed
}
for (const outcome of ['skipped', 'dismissed', 'replied_in_chat', 'legacy-skip'] as const) {
  advertised = true
  const waiting = bridge('AskUserQuestion', input, { requestId: outcome, toolUseID: outcome, signal: new AbortController().signal })
  await reader.read()
  await assert.rejects(runAction({ sessionId: 'fixture', provider: 'claude', body: { action: 'respondQuestion', permissionId: outcome, answers: {}, unanswered: 'future' } }), /Invalid unanswered/)
  if (outcome === 'replied_in_chat') await assert.rejects(runAction({ sessionId: 'fixture', provider: 'claude', body: { action: 'respondQuestion', permissionId: outcome, answers: {}, unanswered: outcome } }), /chat response is required/)
  await runAction({ sessionId: 'fixture', provider: 'claude', body: outcome === 'legacy-skip'
    ? { action: 'respondPermission', permissionId: outcome, response: 'reject' }
    : { action: 'respondQuestion', permissionId: outcome, answers: {}, unanswered: outcome, response: outcome === 'replied_in_chat' ? 'Use a simpler approach' : undefined } })
  const decision = await waiting
  assert.ok(decision)
  assert.equal(decision.behavior, 'allow')
  if (decision.behavior === 'allow') assert.equal((decision.updatedInput?.annotations as Record<string, { unanswered: string }>)['Which approach?'].unanswered, outcome === 'legacy-skip' ? 'skipped' : outcome)
  await reader.read()
}
controller.close()
const directory = await mkdtemp(path.join(tmpdir(), 'sdk-question-sidecars-'))
try {
  const store = createClaudeArtifactStore(directory)
  const result = { type: 'tool_result', tool_use_id: 'ask', content: 'User responded.' }
  const questionResult = { questions, answers: { 'Which approach?': 'User dismissed this question.' }, annotations: { 'Which approach?': { unanswered: 'dismissed' } } }
  await store.capture('fixture', { type: 'user', message: { content: [{ ...result, tool_use_id: 'app' }] }, tool_use_result: { structuredContent: { important: true } } }, 'one')
  for (let i = 0; i < 35; i++) await store.capture('fixture', { type: 'user', message: { content: [{ ...result, tool_use_id: `ask-${i}` }] }, tool_use_result: questionResult }, 'one')
  await store.capture('fixture', { type: 'user', message: { content: [{ ...result, tool_use_id: 'oversized' }] }, tool_use_result: { ...questionResult, response: '字'.repeat(11_000) } }, 'one')
  const stripped = normalizeClaudeHistoryMessages([{ type: 'user', uuid: 'saved', session_id: 'fixture', message: { role: 'user', content: [{ ...result, tool_use_id: 'ask-0' }, { ...result, tool_use_id: 'app' }, { ...result, tool_use_id: 'oversized' }] } }])
  const reopened = createClaudeArtifactStore(directory)
  const restored = await reopened.hydrate('fixture', stripped, 'one')
  const content = (restored[0].message as { content: Array<{ questionResult?: unknown; structuredContent?: unknown }> }).content
  assert.ok(content[0].questionResult, 'SDK-stripped annotations survive process restart and more than 32 asks')
  assert.deepEqual(content[1].structuredContent, { important: true }, 'Question answers must not evict MCP App artifacts')
  assert.equal(content[2].questionResult, undefined, 'Question storage is bounded by UTF-8 bytes, not character count')
  assert.strictEqual((await reopened.hydrate('fixture', stripped, 'other'))[0], stripped[0], 'Provider instances cannot borrow outcomes')
} finally { await rm(directory, { recursive: true, force: true }) }
console.log('SDK follow-ups passed: context attribution, cache lifetime accounting, role-filtered tool namespaces, capability gating, model-visible outcomes, Web controls and live/history rendering')
process.exit(0)
