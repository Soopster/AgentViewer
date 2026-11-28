import assert from 'node:assert/strict'
import { listReaderPlugins, createReaderPluginController } from '../lib/plugins/reader'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS } from '../lib/plugins/enablement'
import { manifest } from '../plugins/tasks/manifest'
import { createWebTaskControls } from '../components/shell/taskControls'

applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
const specs = listReaderPlugins([manifest])
assert.equal(specs[0].surface, 'tasks')
for (const width of [0, 100, 801, 300.5]) assert.throws(() => listReaderPlugins([{ ...manifest, reader: [{ ...manifest.reader[0], width }] }]), /Invalid reader/)
assert.throws(() => listReaderPlugins([manifest, manifest]), /Invalid reader/)
assert.throws(() => listReaderPlugins([{ ...manifest, reader: [{ ...manifest.reader[0], surface: 'missing' }] }]), /Invalid reader/)
const controller = createReaderPluginController(specs)
const token = Symbol(), stale = Symbol()
controller.report('tasks', token, { visible: true, count: 2 })
const snapshot = controller.getSnapshot()
controller.report('tasks', token, { visible: true, count: 2 })
assert.equal(controller.getSnapshot(), snapshot, 'unchanged reports do not rerender the shell')
controller.report('tasks', stale, { visible: false })
controller.remove('tasks', stale)
assert.equal(controller.presentation('tasks')?.visible, true)
assert.equal(controller.open('tasks'), true)
assert.deepEqual(controller.request('tasks'), { serial: 1, action: 'open' })
controller.open('tasks', 'toggle')
assert.deepEqual(controller.request('tasks'), { serial: 2, action: 'toggle' })
assert.equal(controller.open('unknown'), false)
applyPluginSettings({ version: 1, disabled: ['tasks'] })
controller.prune()
assert.equal(controller.presentation('tasks'), undefined)
assert.equal(controller.request('tasks').serial, 0)
assert.equal(controller.open('tasks'), false)
controller.report('tasks', token, { visible: true })
assert.equal(controller.presentation('tasks'), undefined)
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
controller.dispose()
assert.equal(controller.open('tasks'), false)
controller.activate()
assert.equal(controller.open('tasks'), true, 'effect restarts create a live reader lifetime')
controller.dispose()

const originalFetch = globalThis.fetch
let calls = 0, current = true
const target = { provider: 'claude' as const, providerInstanceId: 'work', sessionId: 'same/id' }
try {
  globalThis.fetch = (async (url, init) => {
    calls++
    assert.equal(url, '/api/sessions/same%2Fid/actions')
    assert.equal(init?.signal, signal.signal)
    assert.deepEqual(JSON.parse(String(init?.body)), { provider: 'claude', providerInstanceId: 'work', action: 'stopTask', taskId: 'task-1' })
    return Response.json({ result: { stopped: true } })
  }) as typeof fetch
  const signal = new AbortController()
  const jumps: string[] = []
  const controls = createWebTaskControls(target, () => current, uuid => jumps.push(uuid))
  await assert.rejects(async () => controls.stop!({ ...target, providerInstanceId: 'personal' }, 'task-1'), /does not match/)
  assert.equal(calls, 0)
  await controls.stop!(target, 'task-1', signal.signal)
  controls.jumpTo('task-event')
  assert.deepEqual(jumps, ['task-event'])
  current = false
  await assert.rejects(async () => controls.stop!(target, 'task-1', signal.signal), { name: 'AbortError' })
  assert.throws(() => controls.jumpTo('late'), { name: 'AbortError' })
  assert.equal(calls, 1)
  assert.equal(createWebTaskControls({ ...target, provider: 'codex' }, () => true, () => {}).stop, undefined)
} finally { globalThis.fetch = originalFetch }
console.log('Reader plugins: PASS (bounded metadata, scoped reports, open/toggle, disable, effect restart and captured task controls)')
