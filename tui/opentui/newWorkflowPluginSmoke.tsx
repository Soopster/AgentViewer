/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React, { useState } from 'react'
import { testRender, act } from './testRender'
import { PluginSurfaceHost } from './shell/PluginSurfaceHost'
import { createPluginStateStore } from '../../lib/plugins/scopedState'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS, withPluginEnabled } from '../../lib/plugins/enablement'
import { createTuiRunLaunchService } from './shell/runLaunchService'
import type { StartProtocolRunParams, StartProtocolRunResult } from '../../lib/agentProtocol'
import type { TuiPluginKeyHandler } from './shell/pluginTypes'
import { DARK_THEME as theme } from '../theme'

applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
const cwd = '/fixture/native-workflow'
const store = createPluginStateStore()
const submissions: StartProtocolRunParams[] = []
const accepted: string[] = []
const revealed: string[] = []
const notices: string[] = []
let finish: ((value: StartProtocolRunResult) => void) | null = null
let keys: TuiPluginKeyHandler = () => {}
let changePlacement: (value: 'window' | 'overlay') => void = () => {}
let changeAccount: (value: string) => void = () => {}
let show: (value: boolean) => void = () => {}
let lists = 0
const result = (id: string): StartProtocolRunResult => ({ snapshot: { run: { id, status: 'running' }, agents: [] }, sessions: [] } as unknown as StartProtocolRunResult)
const start = async (params: StartProtocolRunParams) => {
  submissions.push(params)
  return new Promise<StartProtocolRunResult>(resolve => { finish = resolve })
}
function Fixture() {
  const [placement, setPlacement] = useState<'window' | 'overlay'>('overlay')
  const [account, setAccount] = useState('work')
  const [shown, setShown] = useState(true)
  changePlacement = setPlacement
  changeAccount = setAccount
  show = setShown
  const session = { sessionId: 'same-id', provider: 'claude' as const, providerInstanceId: account, cwd, firstPrompt: 'Captured prompt', summary: account, lastModified: 1 }
  const launch = createTuiRunLaunchService(start, value => { accepted.push(value.snapshot.run.id) }, {
    provider: 'claude', providerInstanceId: account, model: `model-${account}`, effort: 'high', prompt: 'Captured prompt',
  })
  const host = shown ? <PluginSurfaceHost surfaceId="new-workflow" placement={placement} session={session} sessionKey={`claude@${account}:same-id`} cwd={cwd}
    theme={theme} width={180} height={44} focused store={store} onClose={() => setShown(false)} onKeyHandlerReady={value => { keys = value }}
    provided={{ 'run-launch': launch, playbooks: {
      list: async () => { lists++; return { playbooks: [{ name: 'fixture-playbook', path: '/fixture/playbook.json', phaseCount: 1, taskCount: 1, expectsArgs: false }], invalid: [] } },
      read: async () => ({ name: 'fixture-playbook', phases: [{ title: 'Work', tasks: [{ key: 'work', title: 'Work', detail: 'Do work', role: 'teammate' }] }] }),
      write: async (_cwd, playbook) => ({ playbook, path: '/fixture/playbook.json' }), remove: async () => {},
    }, coordination: { initialRunId: null, openAgentSession: () => {}, watchAgentSessions: () => {}, watchRun: () => {}, copyJoinCommand: () => {}, revealRun: value => { revealed.push(value.run.id) } },
    notices: { show: (_kind, text) => { notices.push(text) } } }} /> : <text>FORM CLOSED</text>
  // Changing the enclosing key forces a real unmount/remount during relocation.
  return <box key={placement} width={180} height={44}>{host}</box>
}
const setup = await testRender(<Fixture />, { width: 180, height: 44, kittyKeyboard: true })
const screen = () => setup.captureCharFrame()
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) }) }
const waitFor = async (label: string, test: () => boolean) => {
  for (let i = 0; i < 80; i++) { if (test()) return; await settle() }
  throw new Error(`${label}\n${screen()}`)
}
const press = async (name: string, ctrl = false) => { await act(async () => { keys({ name, sequence: name, ctrl, shift: false }) }); await settle() }
const type = async (value: string) => { await act(async () => { await setup.mockInput.typeText(value) }); await settle() }
const launchForm = async () => { await act(async () => { setup.mockInput.pressEnter() }); await settle() }
const reopen = async () => { await act(async () => { show(true) }); await waitFor('form reopened', () => screen().includes('LAUNCH A WORKFLOW')) }

await waitFor('native workflow form', () => screen().includes('LAUNCH A WORKFLOW') && screen().includes('@work'))
await type(' NATIVE-DRAFT')
await waitFor('native prompt typed', () => screen().includes('NATIVE-DRAFT'))
await act(async () => { changeAccount('personal') })
assert.ok(screen().includes('@work') && !screen().includes('@personal'), 'open form must retain its captured configured account')
await act(async () => { changePlacement('window') })
await waitFor('draft moved into window', () => screen().includes('NATIVE-DRAFT') && screen().includes('@work'))
await act(async () => { changePlacement('overlay') })
await waitFor('draft moved back to overlay', () => screen().includes('NATIVE-DRAFT') && screen().includes('@work'))
// The nested manager returns to the same form instance, and reloads its listing.
for (let i = 0; i < 5; i++) await press('tab')
const beforeManage = lists
await press('m')
await waitFor('nested manager', () => screen().includes('REUSABLE COORDINATOR WORKFLOWS') && !screen().includes('LAUNCH A WORKFLOW'))
await press('escape')
await waitFor('nested return and refresh', () => screen().includes('LAUNCH A WORKFLOW') && screen().includes('NATIVE-DRAFT') && lists > beforeManage + 1)
await press('escape')
await waitFor('closed form', () => screen().includes('FORM CLOSED'))
await settle()
await reopen()
assert.ok(screen().includes('@personal') && !screen().includes('NATIVE-DRAFT'), 'new explicit launch at the same cwd must capture the new account')

// Start twice in one native event batch; only one backend request is accepted.
await act(async () => { setup.mockInput.pressEnter(); setup.mockInput.pressEnter() })
await waitFor('launch pending', () => submissions.length === 1)
assert.equal(submissions[0].providerInstanceId, 'personal')
assert.equal(submissions[0].model, 'model-personal')
assert.equal(submissions[0].effort, 'high')
assert.equal(submissions[0].baseCwd, cwd)
await press('escape')
await waitFor('pending form closed', () => screen().includes('FORM CLOSED'))
await act(async () => { finish!(result('accepted-after-close')) })
await settle()
assert.deepEqual(accepted, ['accepted-after-close'], 'host registers accepted work after the form closes')
assert.equal(revealed.length, 0, 'closed presentation must not reopen the control center')
assert.equal(notices.length, 0, 'closed presentation must not send a stale success notice')

await reopen()
// Selecting a different lead provider drops account-specific runtime defaults.
for (let i = 0; i < 7; i++) await press('tab')
await press('right')
await press('tab')
// Return to prompt through the cyclic focus list, then submit through its textarea.
for (let i = 0; i < 10; i++) await press('tab')
await launchForm()
await waitFor('different provider pending', () => submissions.length === 2)
assert.equal(submissions[1].provider, 'codex')
assert.equal(submissions[1].providerInstanceId, undefined)
assert.equal(submissions[1].model, undefined)
assert.equal(submissions[1].effort, undefined)
await act(async () => { applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'coordination', false)) })
await waitFor('disabled launch form', () => !screen().includes('LAUNCH A WORKFLOW'))
await act(async () => { finish!(result('accepted-after-disable')) })
await settle()
assert.deepEqual(accepted, ['accepted-after-close', 'accepted-after-disable'])
assert.equal(revealed.length, 0)
assert.equal(notices.length, 0)
setup.renderer.destroy()
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
console.log('Native workflow plugin: PASS (scoped draft/window moves, captured and reopened account defaults, provider switch, nested Manage, duplicate submit, accepted work after close/disable without stale presentation)')
process.exit(0)
