/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { testRender } from '@opentui/react/test-utils'
import { RemoteNativeRequest } from './RemoteNativeRequest'
import { getThemePalette } from '../theme'
import type { PendingPermission } from '../../lib/permissions'
import type { TuiSessionCoordinationRequest } from '../../lib/tui/service'
import { validateCoordinatorNativeAnswer } from '../../lib/coordinatorNativePermission'

type Key = { name: string; sequence: string; ctrl: boolean; shift: boolean }
const theme = getThemePalette('dark')
for (const [width, height] of [[110, 36], [44, 28]]) {
  const submitted: TuiSessionCoordinationRequest[] = []
  let handler: (key: Key) => void = () => {}
  const permission: PendingPermission = {
    id: 'form-request', provider: 'claude', sessionId: 'native-session', title: 'Three provider questions', toolName: 'AskUserQuestion',
    questions: [
      { id: 'policy', question: 'Policy?', options: [{ label: 'Strict' }, { label: 'Compatible' }] },
      { id: 'surfaces', question: 'Surfaces?', multiSelect: true, allowFreeform: true, options: [{ label: 'API' }, { label: 'TUI' }] },
      { id: 'secret', question: 'Private value?', allowFreeform: true, secret: true, options: [] },
    ],
  }
  const setup = await testRender(<RemoteNativeRequest permission={permission} machineName="remote-box" agentName="reviewer" theme={theme} width={width} height={height} disabledReason={null} onClose={() => {}} onSubmit={async request => { submitted.push(request) }} onKeyHandlerReady={next => { handler = next }} />, { width, height })
  const settle = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 5)) }) }
  const key = async (name: string, sequence = name) => { act(() => handler({ name, sequence, ctrl: false, shift: false })); await settle() }
  await settle()
  await key('return')
  assert.equal(submitted.length, 0)
  assert.ok(setup.captureCharFrame().includes('Answer every required'))
  await key('space', ' ')
  await key('tab')
  await key('space', ' ')
  await key('down')
  await key('space', ' ')
  await key('e')
  for (const char of 'Other') await key(char)
  await key('return')
  await key('tab')
  await key('e')
  for (const char of 'private-secret') await key(char)
  assert.ok(!setup.captureCharFrame().includes('private-secret'), 'secret input stays masked')
  await key('return')
  await key('return')
  assert.ok(setup.captureCharFrame().includes('Confirm answers?'))
  assert.ok(setup.captureCharFrame().includes('Strict'), 'confirmation shows selected answer')
  assert.ok(!setup.captureCharFrame().includes('private-secret'), 'confirmation stays masked')
  await key('y')
  assert.deepEqual(submitted[0].answers, { policy: ['Strict'], surfaces: ['API', 'TUI', 'Other'], secret: ['private-secret'] })
  assert.equal(submitted[0].detail, 'Operator answered the inspected provider request', 'secret answers are excluded from summary text')
  act(() => setup.renderer.destroy())

  for (const kind of ['deny-default', 'plan', 'plan-auto', 'unavailable']) {
    const decisions: TuiSessionCoordinationRequest[] = []
    let answerHandler: (key: Key) => void = () => {}
    const ask: PendingPermission = kind.startsWith('plan')
      ? { id: 'plan', provider: 'claude', title: 'Plan', toolName: 'ExitPlanMode', plan: 'Review the parser and test the strict policy.' }
      : { id: kind, provider: 'claude', title: 'Tool request', command: 'inspect selected files', canApproveAlways: false, defaultToDeny: true }
    const panel = await testRender(<RemoteNativeRequest permission={ask} machineName="remote-box" agentName="reviewer" theme={theme} width={width} height={height} disabledReason={kind === 'unavailable' ? 'Request changed or answered' : null} onClose={() => {}} onSubmit={async request => { decisions.push(request) }} onKeyHandlerReady={next => { answerHandler = next }} />, { width, height })
    const press = async (name: string) => { act(() => answerHandler({ name, sequence: name, ctrl: false, shift: false })); await act(async () => { await panel.flush(); await new Promise(resolve => setTimeout(resolve, 5)) }) }
    await press('noop')
    if (kind.startsWith('plan')) { await press('right'); if (kind === 'plan-auto') await press('right') }
    else assert.ok(panel.captureCharFrame().includes('Reject'), 'default-to-deny selection stays visible at narrow width')
    await press('return')
    assert.equal(decisions.length, 0, 'first Enter never answers a provider request')
    await press('y')
    if (kind === 'unavailable') assert.equal(decisions.length, 0)
    else if (kind.startsWith('plan')) { assert.equal(decisions[0].response, 'once'); assert.equal(decisions[0].permissionMode, kind === 'plan-auto' ? 'acceptEdits' : 'default') }
    else { assert.equal(decisions[0].response, 'reject'); assert.equal(decisions[0].permissionMode, undefined) }
    act(() => panel.renderer.destroy())
  }
  console.log(`Remote native request rendered smoke passed (${width}x${height}: required questions, multiple selections, custom/secret answers, reviewed confirmation, visible default deny, plan continuation mode, unavailable observation gate)`)
}
assert.throws(() => validateCoordinatorNativeAnswer({ id: 'tool', title: 'Tool', canApproveAlways: false }, { response: 'always' }), /persistent/)
assert.throws(() => validateCoordinatorNativeAnswer({ id: 'tool', title: 'Tool' }, { response: 'once', permissionMode: 'acceptEdits' }), /Only plan/)
process.exit(0)
