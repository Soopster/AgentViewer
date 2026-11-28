/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { useState } from 'react'
import { testRender, act } from './testRender'
import { ComposerAccessoryHost } from './shell/ComposerAccessoryHost'
import { tuiComposerPlugins } from './shell/composerPlugins'
import { useComposerAccessories } from '../../lib/plugins/useComposerAccessories'
import { applyPluginSettings } from '../../lib/plugins/enablement'
import { getThemePalette } from '../theme'
import type { ComposerTurnContext } from '../../lib/plugins/composer'

const theme = getThemePalette('dark')
const session = { provider: 'codex' as const, providerInstanceId: 'fixture', sessionId: 'tips', cwd: '/fixture' }
let update: ((state: { attention?: boolean; visible?: boolean; width?: number }) => void) | undefined
let rows = 0
function Fixture() {
  const [start] = useState(Date.now)
  const [state, setState] = useState({ attention: false, visible: true, width: 100 })
  update = next => setState(previous => ({ ...previous, ...next }))
  const accessories = useComposerAccessories('tui', 'tips-fixture')
  rows = accessories.snapshot.rows
  const turn: ComposerTurnContext = { id: `fixture:${start}`, startedAt: start, running: true, needsAttention: state.attention }
  return <box flexDirection="column" width={state.width}>
    <box id="draft" height={3}><text>My unchanged draft</text></box>
    <text>Working · esc to interrupt</text>
    <ComposerAccessoryHost placement="footer" turn={turn} session={session} draft="My unchanged draft" disabled visible={state.visible}
      controller={accessories.controller} isCurrent={accessories.isCurrent} services={{}}
      theme={theme} width={state.width} viewportWidth={state.width} height={12} marginLeft={0} />
  </box>
}
const originalRandom = Math.random
Math.random = () => 0
await tuiComposerPlugins.load('tips')
let setup!: Awaited<ReturnType<typeof testRender>>
await act(async () => { setup = await testRender(<Fixture />, { width: 100, height: 12 }) })
try {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); await setup.flush() })
  assert.equal(rows, 0)
  assert.ok(!setup.captureCharFrame().includes('Tip:'))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 8100)); await setup.flush() })
  let frame = setup.captureCharFrame()
  assert.ok(frame.includes('Tip:') && frame.includes('Session goal'), frame)
  assert.equal(rows, 1)
  const tip = setup.renderer.root.findDescendantById('feature-tip') as unknown as { y: number; height: number }
  const draft = setup.renderer.root.findDescendantById('draft') as unknown as { y: number; height: number }
  assert.equal(tip.height, 1)
  assert.ok(tip.y >= draft.y + draft.height)
  assert.equal(draft.height, 3, 'hint must not shrink the draft')
  await act(async () => { update!({ width: 28 }); await setup.flush() })
  assert.equal((setup.renderer.root.findDescendantById('feature-tip') as unknown as { height: number }).height, 1)
  frame = setup.captureCharFrame()
  assert.ok(frame.includes('Tip:'))
  await act(async () => { update!({ attention: true }); await setup.flush() })
  assert.ok(!setup.captureCharFrame().includes('Tip:'))
  assert.equal(rows, 0)
  await act(async () => { update!({ attention: false }); await setup.flush() })
  assert.equal(rows, 0, 'attention dismissal must not replay')
  await act(async () => { applyPluginSettings({ version: 1, disabled: ['tips'] }); await setup.flush() })
  assert.equal(rows, 0)
  await act(async () => { applyPluginSettings({ version: 1, disabled: [] }); await setup.flush() })
  assert.equal(rows, 0)
  console.log('OpenTUI tips: PASS (real footer host, timing, one-row layout, narrow width, attention, disable/re-enable)')
} finally {
  Math.random = originalRandom
  await act(async () => { setup.renderer.destroy() })
}
process.exit(0)
