// Pins the Claude Agent SDK signals agent-viewer had been dropping on the floor.
//
// Three of the SDK's system messages had no handler at all — a refusal with no
// fallback model, the CLI announcing its own worker teardown, and a mid-session
// conversation reset. Each arrived as an untyped system row (or, for the reset,
// not at all), so the transcript went quiet with no explanation. A fourth gap
// was in retry policy: the SDK exports the exact prose its usage-limit
// generators emit, and without consulting it "out of usage" is indistinguishable
// from "API overloaded" to a substring matcher.
//
// These are pure mapping/classification checks — no network, no subprocess.
import assert from 'node:assert/strict'
import { normalizeClaudeHistoryMessages, normalizeClaudeStreamThreadedMessage } from '../lib/claudeMapper'
import { effortToSdk } from '../lib/claudePool'
import { formatClaudeRuntimeCounts, formatClaudeRuntimeDetailLines } from '../lib/claudeSdkFeatures'
import { classifyClaudeUsageMessage, isClaudeUsageLimitError } from '../lib/claudeUsageLimits'
import { isTransientSendError } from '../lib/transientError'
import { formatMessageExpanded, formatTranscriptCards } from '../tui/format'
import type { SystemMessagePayload } from '../lib/types'

// --- usage-limit classification -------------------------------------------
// Buckets come from the SDK's own prefix constants, so a wording change
// upstream moves these with it rather than silently reclassifying.
assert.equal(classifyClaudeUsageMessage("You've hit your 5-hour limit · resets at 3pm"), 'limit-reached')
assert.equal(classifyClaudeUsageMessage('This service is disabled for your org'), 'org-policy')
assert.equal(classifyClaudeUsageMessage("You're now using usage credits"), 'transition')
assert.equal(classifyClaudeUsageMessage("You've used 90% of your weekly limit"), 'warning')
// Ordinary transient failures must stay unclassified, or every overload would
// render as a billing problem.
assert.equal(classifyClaudeUsageMessage('Claude API error (HTTP 429): overloaded_error'), null)
assert.equal(classifyClaudeUsageMessage('fetch failed'), null)
assert.equal(classifyClaudeUsageMessage(null), null)

// Org policy wins over the usage bucket: both arrive on the same error path,
// but the SDK is explicit that policy text must never render as a usage card.
assert.equal(isClaudeUsageLimitError('This service is disabled for your org'), true)
assert.equal(isClaudeUsageLimitError("You've used 90% of your weekly limit"), false)

// --- retry policy ----------------------------------------------------------
// The load-bearing case: a usage limit that arrives *as* an HTTP 429. The
// structural status says "transient", the classification says otherwise, and
// the classification has to win — retrying can only fail the same way.
const limitMessage = "Claude API error (HTTP 429): You've hit your 5-hour limit"
assert.equal(
  isTransientSendError(limitMessage, 429, classifyClaudeUsageMessage(limitMessage)),
  false,
  'a usage limit delivered as HTTP 429 must not be auto-retried',
)
assert.equal(
  isTransientSendError('Claude API error (HTTP 429): overloaded_error', 429, null),
  true,
  'a genuine overload must still be auto-retried',
)

// --- message mapping -------------------------------------------------------
const RAW = [
  {
    type: 'system',
    subtype: 'model_refusal_no_fallback',
    original_model: 'claude-opus-5',
    api_refusal_category: 'policy',
    uuid: 'u1',
    session_id: 's',
  },
  { type: 'system', subtype: 'worker_shutting_down', reason: 'remote_control_disabled', uuid: 'u2', session_id: 's' },
  { type: 'conversation_reset', new_conversation_id: 'abcdef12-0000-0000-0000-000000000000', uuid: 'u3', session_id: 's' },
] as ReadonlyArray<Record<string, unknown>>

const EXPECTED: Record<string, { needle: string; level: string }> = {
  model_refusal_no_fallback: { needle: 'no fallback', level: 'warning' },
  worker_shutting_down: { needle: 'worker shutting down', level: 'notice' },
  conversation_reset: { needle: 'conversation reset', level: 'notice' },
}

for (const raw of RAW) {
  const threaded = normalizeClaudeStreamThreadedMessage(raw)
  assert.ok(threaded, `live stream dropped ${String(raw.subtype ?? raw.type)}`)
  const block = threaded.blocks[0] as { subtype: string; payload: SystemMessagePayload }
  const expected = EXPECTED[block.subtype]
  assert.ok(expected, `unexpected mapped subtype ${block.subtype}`)
  assert.ok(
    typeof block.payload.content === 'string' && block.payload.content.length > 0,
    `${block.subtype} mapped without renderable content`,
  )
  assert.equal(block.payload.level, expected.level, `${block.subtype} mapped at the wrong severity`)

  // Both TUI formatters must recognize the subtype rather than falling through
  // to the generic system row (shared by the OpenTUI and Ink renderers).
  const card = JSON.stringify(formatTranscriptCards([threaded])).toLowerCase()
  const expanded = JSON.stringify(formatMessageExpanded([threaded], threaded.uuid!)).toLowerCase()
  assert.ok(card.includes(expected.needle), `${block.subtype} missing from TUI card: ${card}`)
  assert.ok(expanded.includes(expected.needle), `${block.subtype} missing from TUI expanded view`)
}

// History JSONL nests the system payload under `.message` while the live stream
// delivers it flat. Both shapes have to enrich, or a reload loses the row.
const history = normalizeClaudeHistoryMessages(RAW.map((raw) => ({ ...raw, message: raw })))
assert.equal(history.length, RAW.length, 'history mapping dropped a message')
for (const message of history) {
  const payload = message.message as SystemMessagePayload
  const expected = EXPECTED[payload.subtype]
  assert.ok(expected, `unexpected history subtype ${payload.subtype}`)
  assert.ok(
    typeof payload.content === 'string' && payload.content.length > 0,
    `${payload.subtype} lost its content on the history path`,
  )
}

// SDK 0.3.247+ identifies housekeeping tasks that should stay out of the
// user-facing activity count while real background work remains visible.
const backgroundTasks = {
  subtype: 'background_tasks_changed',
  tasks: [
    { task_id: 'task-user', task_type: 'local_workflow', description: 'Index the repository' },
    { task_id: 'task-ambient', task_type: 'watcher', description: 'Watch for updates', ambient: true },
  ],
} as unknown as SystemMessagePayload
assert.deepEqual(formatClaudeRuntimeCounts(backgroundTasks), ['1 background task'])
assert.deepEqual(formatClaudeRuntimeDetailLines(backgroundTasks), [
  'Background tasks:',
  '- 1. local_workflow running: Index the repository',
])
assert.deepEqual(formatClaudeRuntimeCounts({
  subtype: 'background_tasks_changed',
  tasks: [{ task_id: 'task-ambient', task_type: 'watcher', description: 'Watch for updates', ambient: true }],
} as unknown as SystemMessagePayload), [])

// --- warm-pool effort changes ---------------------------------------------
// applyFlagSettings({effortLevel}) applies a named-level change in place, so
// the pool must NOT respawn for it. 'off' and 'minimal' instead map to a
// `thinking` config, which has no live control method — those must still
// respawn, or a warm entry would silently keep thinking enabled after the user
// turned it off. This mirrors the exact predicate ClaudePool.compatible() uses.
const liveApplicable = (from: string | undefined, to: string | undefined) =>
  Boolean(effortToSdk(from as never).effort && effortToSdk(to as never).effort)

for (const [from, to] of [['high', 'low'], ['low', 'max'], ['minimal', 'high']] as const) {
  const want = from !== 'minimal'
  assert.equal(liveApplicable(from, to), want, `effort ${from} -> ${to} live-applicability regressed`)
}
for (const [from, to] of [['high', 'off'], ['off', 'high'], ['high', 'minimal'], ['high', undefined], [undefined, 'high']] as const) {
  assert.equal(liveApplicable(from, to), false, `effort ${from} -> ${to} must force a respawn`)
}

console.log('Claude SDK surface smoke passed')
