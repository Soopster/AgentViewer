/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React from 'react'
import type { TuiTranscriptCard } from '../format'
import { DARK_THEME } from '../theme'
import { act, testRender } from './testRender'
import { PromptNavigation, promptNavigationRows, promptNavigationState, promptNavigationPreview } from './app/PromptNavigation'

const cards = ['user', 'assistant', 'user', 'assistant'].map((role, index) => ({
  key: `card-${index}`, role, compactSummary: 'Identical request',
  lines: [{ text: 'Identical request', tone: 'default' }],
})) as TuiTranscriptCard[]
assert.equal(promptNavigationState(cards, 'card-1', false).current, 0)
assert.equal(promptNavigationState(cards, 'card-3', false).current, 1)
assert.equal(promptNavigationState(cards, 'card-0', true).current, 1, 'Following always describes the latest turn')
assert.equal(promptNavigationState([], null, false).prompts.length, 0)
assert.equal(promptNavigationState(cards, null, false).prompts.length, 2, 'Identical prompts retain separate identities')
const tablePrompt = { ...cards[0]!, lines: [
  { text: 'Do |  |  |  |', tone: 'default' as const },
  { text: '|---|---|---|', tone: 'default' as const },
  { text: '| Transcript navigation | Add a compact sticky current-turn header |  |', tone: 'default' as const },
] }
assert.equal(promptNavigationPreview(tablePrompt), 'Do Transcript navigation · Add a compact sticky current-turn header')
assert.ok(promptNavigationPreview({ ...tablePrompt, lines: [...tablePrompt.lines, { text: 'Run cat file | head -20', tone: 'default' }] }).endsWith('Run cat file | head -20'), 'Commands following a table preserve pipes')
assert.equal(promptNavigationPreview({ ...cards[0]!, lines: [{ text: 'Run cat file | head -20', tone: 'default' }] }), 'Run cat file | head -20', 'Ordinary shell pipes remain intact')

assert.equal(promptNavigationPreview({ ...cards[0]!, lines: [{ text: '[local image] /tmp/clipboard.png', tone: 'default' }, { text: 'Make the inspector a window', tone: 'default' }] }), 'Make the inspector a window')
assert.equal(promptNavigationPreview({ ...cards[0]!, lines: [{ text: '[local image] /tmp/clipboard.png', tone: 'default' }] }), 'Image attachment')

for (const width of [24, 48, 80, 120]) {
  let jumped: string | null = null
  let latest = false
  const rows = promptNavigationRows(width)
  const setup = await testRender(<box width={width + 2} height={rows}>
    <PromptNavigation cards={cards} currentKey="card-3" following={false} width={width} theme={DARK_THEME}
      onJump={key => { jumped = key }} onLatest={() => { latest = true }} />
  </box>, { width: width + 2, height: rows })
  try {
    await act(async () => { await setup.flush() })
    const frame = setup.captureCharFrame()
    for (const label of ['Turn 2/2', 'Previous prompt', 'Next prompt', 'Latest']) assert.ok(frame.includes(label), `${label} fits at width ${width}`)
    const previous = setup.renderer.root.findDescendantById('prompt-navigation:previous-prompt')!
    const tail = setup.renderer.root.findDescendantById('prompt-navigation:latest')!
    assert.ok(previous.y < rows && tail.y < rows, 'Controls fit the reserved header rows')
    await act(async () => { await setup.mockMouse.click(previous.x + 1, previous.y) })
    assert.equal(jumped, 'card-0')
    await act(async () => { await setup.mockMouse.click(tail.x + 1, tail.y) })
    assert.ok(latest)
  } finally { await act(async () => { setup.renderer.destroy() }) }
}
console.log('Prompt navigation boundaries, repeated identities, responsive controls and click smoke passed')
process.exit(0)
