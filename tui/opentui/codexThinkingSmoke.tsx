/** @jsxImportSource @opentui/react */
import React, { useState } from 'react'
import { useKeyboard } from '@opentui/react'
import assert from 'node:assert/strict'
import { testRender, act } from './testRender'
import { CodexThinkingPreview } from './app/overlays/CodexThinkingPreview'
import { getThemePalette } from '../theme'
import type { ThinkingBlock } from '../../lib/types'
import { formatTranscriptCard } from '../format'
import { visibleCardsForTranscriptView, resolveExpandedCardKeys, renderedBodyLines } from './app/transcriptRows'
import { runToggleExpansion } from './app/actions/interaction'
import type { TuiTranscriptView } from '../theme'
let update: (block: ThinkingBlock) => void = () => {}
const startedAt = Date.now() - 18000
function Preview() {
  const [block, setBlock] = useState<ThinkingBlock>({ type: 'thinking', thinking: '', reasoning: { startedAt } })
  update = setBlock
  return <CodexThinkingPreview block={block} theme={getThemePalette('dark')} width={100} />
}
const setup = await testRender(<Preview />, { width: 100, height: 8 })
try {
  await act(async () => { await setup.flush() })
  let frame = setup.captureCharFrame()
  assert.match(frame, /Thinking 18s/)
  assert.ok(!frame.includes('tokens'), 'unknown usage must not be rendered as zero or an estimate')
  assert.match(frame, /Waiting for a reasoning summary/)
  await act(async () => { update({ type: 'thinking', thinking: 'Earlier summary\n\nChecking provider receipts.', reasoning: { startedAt, tokens: 2400, tokenScope: 'turn' } }); await setup.flush() })
  frame = setup.captureCharFrame()
  assert.match(frame, /2.4k turn reasoning tokens/)
  assert.match(frame, /Checking provider receipts/)
  assert.ok(!frame.includes('Earlier summary'), 'the compact preview shows the latest summary')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); await setup.flush() })
  assert.match(setup.captureCharFrame(), /Thinking 19s/, 'elapsed time updates without another provider event')
  console.log('OpenTUI Codex thinking preview: unknown usage, latest summary, reported counts and ticking elapsed time passed')
} finally { await act(async () => { setup.renderer.destroy() }) }
const completedCards = [undefined, undefined, 193].map((tokens, index) => formatTranscriptCard({
  role: 'assistant', provider: 'codex', uuid: `empty-thinking-${index}`,
  blocks: [{ type: 'thinking', thinking: '', reasoning: { startedAt: 1000, completedAt: 1001, tokens, tokenScope: 'turn' } }],
}))
const visible = visibleCardsForTranscriptView(completedCards, 'codex')
assert.equal(visible.length, 1, 'empty completed phases must not become transcript rows')
const transcript = await testRender(<box flexDirection="column">{visible.flatMap(card => card.lines).map((line, index) => <text key={index}>{line.text}</text>)}</box>, { width: 100, height: 8 })
try {
  await act(async () => { await transcript.flush() })
  const frame = transcript.captureCharFrame()
  assert.equal((frame.match(/Thought/g) ?? []).length, 1, 'the screenshot sequence must render one useful usage row')
  assert.ok(!frame.includes('0s'), 'zero-second lifecycle timestamps are omitted')
  assert.match(frame, /193 turn reasoning tokens/)
  console.log('OpenTUI completed reasoning: empty phases hidden and one reported token row retained')
} finally { await act(async () => { transcript.renderer.destroy() }) }
const thinkingCard = formatTranscriptCard({ role: 'assistant', provider: 'codex', uuid: 'full-thinking', blocks: [{
  type: 'thinking', thinking: 'First summary section\n\nLatest summary section', reasoningText: 'Additional returned reasoning transcript', reasoning: { completed: true },
}] })
function ExpandableThinking({ view }: { view: TuiTranscriptView }) {
  const [expanded, setExpanded] = useState(new Set<string>())
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const resolved = resolveExpandedCardKeys([thinkingCard], view, false, expanded, collapsed)
  useKeyboard(key => {
    if (key.name === 'return') runToggleExpansion({
      readCursorIndex: () => 0, visibleTranscriptCards: [thinkingCard], groupedToolView: false,
      resolvedExpandedKeys: resolved, agentToolCursorByGroupKey: {}, transcriptView: view, isChatLikeView: false,
      expandedCardKeys: expanded, collapsedCardKeys: collapsed,
      setAgentToolCursorByGroupKey: () => {}, setCollapsedCardKeys: setCollapsed, setExpandedCardKeys: setExpanded,
    })
  })
  return <box flexDirection="column">{renderedBodyLines(thinkingCard, resolved.has(thinkingCard.key), 2).map((line, index) => <text key={index}>{line.text}</text>)}</box>
}
for (const view of ['codex', 'conversation', 'stream'] as const) {
  const expanded = await testRender(<ExpandableThinking view={view} />, { width: 100, height: 12 })
  try {
    await act(async () => { await expanded.flush() })
    assert.ok(!expanded.captureCharFrame().includes('Additional returned reasoning transcript'), `${view}: full thinking starts folded`)
    await act(async () => { expanded.mockInput.pressEnter(); await expanded.flush() })
    assert.match(expanded.captureCharFrame(), /First summary section/, `${view}: Enter reveals earlier summary sections`)
    assert.match(expanded.captureCharFrame(), /Additional returned reasoning transcript/, `${view}: Enter reveals all provider reasoning text`)
    await act(async () => { expanded.mockInput.pressEnter(); await expanded.flush() })
    assert.ok(!expanded.captureCharFrame().includes('Additional returned reasoning transcript'), `${view}: Enter folds the transcript again`)
  } finally { await act(async () => { expanded.renderer.destroy() }) }
}
console.log('OpenTUI thinking transcript expands and folds with Enter in Codex, Conversation and Stream views')
process.exit(0)
