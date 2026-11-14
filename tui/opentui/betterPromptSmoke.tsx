/** @jsxImportSource @opentui/react */
import React, { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import assert from 'node:assert/strict'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { createComposerAccessoryController } from '../../lib/plugins/composerHost'
import { ComposerAccessoryBoundary } from '../../lib/plugins/ComposerAccessoryBoundary'
import { manifest } from '../../plugins/better/manifest'
import { mergeComposerRewrite } from '../../lib/plugins/composer'
const { mock } = await (0, eval)('import("bun:test")')
let resolveJob: ((result: unknown) => void) | undefined
let jobSignal: AbortSignal | undefined
let progress: ((value: import('../../lib/plugins/betterProgress').BetterProgress) => void) | undefined
mock.module('./shell/sdkBetter', () => ({ researchBetterPrompt: async (_session: unknown, _draft: string, signal: AbortSignal, onProgress: typeof progress) => {
  progress = onProgress
  jobSignal = signal
  return new Promise(resolve => { resolveJob = resolve })
} }))
const { composer } = await import('../../plugins/better/tui')
const spec = { ...manifest.composer[0], pluginId: 'better' }
const controller = createComposerAccessoryController([spec])
const registry = { load: async () => composer, peek: () => composer }
let draft = '/better Original task'
let typeDraft: (value: string) => void = () => {}
const live = new AbortController()
function Fixture() {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [text, setText] = useState(draft)
  const current = useRef(text); current.current = text
  typeDraft = value => { draft = value; setText(value) }
  const services = useMemo(() => ({ composer: { sendDraft() { assert.fail('Must never send') }, stageDraft(value: string, original: string) { draft = mergeComposerRewrite(current.current, original, value); setText(draft) } } }), [])
  return <box flexDirection="column"><text>{text}</text><ComposerAccessoryBoundary
    spec={spec} registry={registry} controller={controller} isCurrent={() => !live.signal.aborted} Failure={({ error }) => <text>{error.message}</text>}
    props={{ session: { provider: 'pi', providerInstanceId: 'work', sessionId: 'same' }, cwd: '/fixture', draft: text, visible: true, disabled: false,
      services, theme: DARK_THEME, width: 80, viewportWidth: 80, height: 30, marginLeft: 0, modalZIndex: 70 }} /></box>
}
const setup = await testRender(<Fixture />, { width: 80, height: 30, kittyKeyboard: true })
try {
  await act(async () => { controller.open('better-prompt', { slash: { name: 'better', arguments: 'Original task', draft } }) })
  assert.ok(resolveJob)
  assert.equal(draft, '')
  assert.equal(controller.getSnapshot().rows, 2)
  assert.equal(controller.getSnapshot().modal, false)
  await act(async () => {
    typeDraft('New notes')
    progress!({ stage: 3, startedAt: Date.now() - 87000, total: 2, failed: 1, tools: [{ id: 'read', label: 'read docs/raw.md', status: 'ok' }, { id: 'grep', label: 'grep TODO', status: 'error' }] })
  })
  const screen = setup.captureCharFrame()
  assert.match(screen, /Picking the methods/)
  assert.match(screen, /1m 27s/)
  assert.ok(screen.split('\n').every(line => [...line].length <= 80))
  assert.match(screen, /✓ read docs\/raw.md/)
  assert.match(screen, /✗ grep TODO/)
  assert.match(screen, /2 tools · 1 failed/)
  await act(async () => { resolveJob!({ prompt: 'Improved task', summary: 'Research notes', helper: { provider: 'pi', sessionId: 'helper' } }) })
  assert.equal(draft, 'Improved task\n\nNew notes')
  assert.match(setup.captureCharFrame(), /improved prompt is in your input/)
  assert.equal(controller.getSnapshot().rows, 2)
  const completedFrame = setup.captureCharFrame().split('\n')
  const dismissRow = completedFrame.findIndex(line => line.includes('[× dismiss]'))
  assert.ok(dismissRow >= 0)
  const preservedDraft = draft
  await act(async () => { await setup.mockMouse.click(completedFrame[dismissRow].indexOf('[× dismiss]') + 2, dismissRow) })
  assert.equal(controller.getSnapshot().rows, 0)
  assert.equal(draft, preservedDraft)
  assert.ok(!setup.captureCharFrame().includes('improved prompt is in your input'))
  await act(async () => { controller.open('better-prompt', { slash: { name: 'better', arguments: 'Next task', draft } }) })
  await act(async () => {
    assert.equal(controller.handleKey({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }), true)
    assert.equal(controller.handleKey({ name: 'escape', ctrl: false, shift: false, sequence: '\u001b' }), false)
  })
  assert.equal(jobSignal?.aborted, true)
  console.log('OpenTUI Better composer: PASS (real renderer, two live rows, stage/timer/tools/failures, automatic draft insertion, preserved newer text, dismissal releases rows and preserves the draft, first Escape cancels and second passes through; mocked helper)')
} finally {
  await act(async () => { live.abort(); controller.dispose(); setup.renderer.destroy() })
}
