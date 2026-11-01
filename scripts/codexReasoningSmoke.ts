import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCodexReasoningTracker } from '../lib/codexReasoning'
import { readCodexReasoningMetadata, saveCodexReasoningMetadata } from '../lib/codexReasoningStore'
import { normalizeCodexStreamThreadedMessage, mapCodexThreadToMessages } from '../lib/codexMapper'
import { reasoningLabel, hasReasoningContent, thinkingTranscriptText } from '../lib/reasoningDisplay'
import { messageToCopyText } from '../lib/threadedMessageText'
import { formatTranscriptCard } from '../tui/format'
import { indexComposerMessages, visibleComposerMessages } from '../lib/composerTranscript'
import { runTranscriptCards } from '../tui/opentui/app/derived/transcriptCards'
import { buildTaskRegistry } from '../lib/taskRegistry'
import type { CodexNotification, CodexThreadTokenUsage, CodexThread } from '../lib/codexProtocol'
import type { SessionMessage, ThinkingBlock } from '../lib/types'
const usage = (total: number, last = total): CodexThreadTokenUsage => ({ total: { reasoningOutputTokens: total }, last: { reasoningOutputTokens: last } }) as CodexThreadTokenUsage
const tracker = createCodexReasoningTracker('thread', usage(10000))
const update = (method: string, params: object, now = 1000) => tracker.update({ method, params: { threadId: 'thread', turnId: 'turn', ...params } } as CodexNotification, now)
const block = (message: SessionMessage): ThinkingBlock => {
  assert.ok(Array.isArray(message.message.content))
  const found = message.message.content.find((block): block is ThinkingBlock => block.type === 'thinking' && typeof block.thinking === 'string')
  assert.ok(found?.type === 'thinking')
  return found
}
const item = { type: 'reasoning', id: 'thought', summary: [], content: [] }
const [started] = update('item/started', { item, startedAtMs: 1000 })
assert.equal(reasoningLabel(block(started), 19000), 'Thinking 18s', 'omit token counts until reported')
assert.equal(reasoningLabel({ type: 'thinking', thinking: '', reasoning: { startedAt: 1000, completed: true } }, 19000), 'Thought', 'a missing completion timestamp must not count idle time as thinking')
const emptyPhase: ThinkingBlock = { type: 'thinking', thinking: '', reasoning: { startedAt: 1000, completedAt: 1001 } }
assert.equal(reasoningLabel(emptyPhase), 'Thought', 'near-simultaneous provider lifecycle events must not produce Thought for 0s')
assert.equal(hasReasoningContent(emptyPhase), false, 'empty phases contain no displayable reasoning')
const emptyCard = formatTranscriptCard({ role: 'assistant', uuid: 'empty-phase', provider: 'codex', blocks: [emptyPhase] })
assert.deepEqual(emptyCard.lines, [], 'collapsed rendering must hide empty thinking phases')
assert.deepEqual(emptyCard.expandedLines, [], 'expanded rendering must hide empty thinking phases')
assert.equal(reasoningLabel({ ...emptyPhase, reasoning: { ...emptyPhase.reasoning, tokens: 51, tokenScope: 'turn' } }), 'Thought · 51 turn reasoning tokens', 'retain real usage without the misleading zero-second duration')
update('item/reasoning/summaryTextDelta', { itemId: 'thought', summaryIndex: 0, delta: 'Checking ordering.' })
const [sections] = update('item/reasoning/summaryTextDelta', { itemId: 'thought', summaryIndex: 1, delta: 'Checking provider receipts.' })
assert.equal(block(sections).thinking, 'Checking ordering.\n\nChecking provider receipts.', 'preserve summary boundaries')
assert.deepEqual(item.summary, [], 'reasoning deltas must not mutate the provider notification snapshot')
const [reported] = update('thread/tokenUsage/updated', { tokenUsage: usage(12400, 2400) })
assert.equal(block(reported).reasoning?.tokens, 2400, 'subtract prior thread usage')
assert.match(reasoningLabel(block(reported), 19000), /2.4k turn reasoning tokens/)
assert.equal(update('thread/tokenUsage/updated', { tokenUsage: usage(12400, 2400) }).length, 0, 'duplicate usage events must not cause transcript updates')
assert.equal(tracker.metadata()['turn:thought'].tokens, 2400, 'duplicate usage events cannot double count')
const [completed] = update('item/completed', { item: { ...item, summary: ['Checking ordering.', 'Provider receipts are consistent.'], content: ['Raw text must not be appended to the summary.'] }, completedAtMs: 19000 }, 19000)
assert.equal(reasoningLabel(block(completed)), 'Thought for 18s · 2.4k turn reasoning tokens')
assert.ok(!block(completed).thinking.includes('Raw text'))
assert.match(thinkingTranscriptText(block(completed)), /Raw text must not be appended to the summary\./, 'provider reasoning text must remain available in the expanded transcript')
const normalized = normalizeCodexStreamThreadedMessage({ type: 'codex_reasoning', message: completed })!
assert.ok(normalized)
const card = formatTranscriptCard(normalized)
assert.equal(card.autoFold, true)
assert.match(card.lines[0].text, /Thought for 18s/)
assert.ok(card.expandedLines.some(line => line.text === 'Checking ordering.'), 'expanding retains the full summary')
assert.ok(card.expandedLines.some(line => line.text.includes('Raw text')), 'expanding also retains additional provider reasoning text')
assert.match(messageToCopyText(normalized), /Raw text/, 'copying thinking must include the full returned transcript')
const stale = { ...normalized, blocks: [{ ...block(completed), reasoning: { completed: true } }] }
const overlay = visibleComposerMessages([normalized], indexComposerMessages([stale]))
assert.deepEqual(overlay, [normalized], 'a stale persisted row must not hide newer reasoning metrics')
const merged = runTranscriptCards({ liveTranscriptMessagesForSession: overlay, baseAndBridgeTranscriptCards: [formatTranscriptCard(stale)], showToolCalls: true, liveTurnStartedAt: 1000, latestBaseAndBridgeTimestamp: 0, density: 'balanced', baseTaskContext: { activeForms: new Map(), taskRegistry: buildTaskRegistry([]) } })
assert.equal(merged.length, 1, 'polling must replace the existing thinking row, not duplicate it at the tail')
assert.match(merged[0].lines[0].text, /2.4k/)
update('turn/completed', { turn: { id: 'turn' } }, 20000)
const previousCwd = process.cwd()
const scratch = await mkdtemp(path.join(tmpdir(), 'codex-reasoning-'))
try {
  process.chdir(scratch)
  await Promise.all([saveCodexReasoningMetadata('thread', tracker.metadata()), saveCodexReasoningMetadata('thread', { other: { startedAt: 100 } })])
  const restored = await readCodexReasoningMetadata('thread')
  assert.equal(restored['turn:thought'].tokens, 2400)
  assert.ok(restored.other, 'concurrent saves must preserve both updates')
  const archived = mapCodexThreadToMessages({ id: 'thread', turns: [{ id: 'turn', status: 'completed', items: [{ ...item, summary: ['Saved summary'], content: ['Saved full reasoning text'] }] }] } as unknown as CodexThread, restored)
  assert.equal(reasoningLabel(block(archived[0])), 'Thought for 18s · 2.4k turn reasoning tokens', 'reopened transcripts retain reported metrics')
  assert.match(thinkingTranscriptText(block(archived[0])), /Saved full reasoning text/, 'reopened transcripts retain provider reasoning text alongside the summary')
  const historical = mapCodexThreadToMessages({ id: 'thread', turns: [{ id: 'turn', status: 'completed', items: [{ ...item, summary: ['Old summary'], content: [] }] }] } as unknown as CodexThread)
  assert.equal(reasoningLabel(block(historical[0])), 'Thought', 'historical transcripts must not invent time or tokens')
  const emptySummary = mapCodexThreadToMessages({ id: 'thread', turns: [{ id: 'turn', status: 'completed', items: [item] }] } as unknown as CodexThread, restored)
  assert.equal(block(emptySummary[0]).reasoning?.tokens, 2400, 'reported usage must remain visible even without a text summary')
  const emptyPhases = mapCodexThreadToMessages({ id: 'thread', turns: [{ id: 'turn', status: 'completed', items: [{ ...item, id: 'empty-1' }, { ...item, id: 'empty-2' }, item] }] } as unknown as CodexThread,
    { ...restored, 'turn:empty-1': { startedAt: 1000, completedAt: 1000 }, 'turn:empty-2': { startedAt: 1001, completedAt: 1002 } })
  assert.equal(emptyPhases.length, 1, 'the screenshot sequence of empty phases must collapse to its one reported usage row')
} finally { process.chdir(previousCwd); await rm(scratch, { recursive: true, force: true }) }
const noBaseline = createCodexReasoningTracker('thread')
noBaseline.update({ method: 'item/started', params: { threadId: 'thread', turnId: 'turn', item, startedAtMs: 1000 } } as CodexNotification)
assert.equal(block(noBaseline.update({ method: 'thread/tokenUsage/updated', params: { tokenUsage: usage(50000, 250) } } as CodexNotification)[0]).reasoning?.tokens, 250, 'the first usage update must not report lifetime thread usage')
console.log('Codex reasoning: timing, section boundaries, reported turn usage, repeated updates, compact cards, polling and persistence passed')
