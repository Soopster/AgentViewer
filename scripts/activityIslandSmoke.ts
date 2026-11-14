import assert from 'node:assert/strict'
import { createActivityFeed } from '../lib/plugins/activityFeed'
import { createNotificationCenter } from '../lib/plugins/notifications'
import { createPluginApplicationHost } from '../lib/plugins/applicationHost'
import { createPluginCommandHost } from '../lib/plugins/commandHost'
import { PLUGIN_API_VERSION, type PluginManifest } from '../lib/plugins/types'
import type { PluginActivitySnapshot } from '../lib/plugins/application'
import { manifest } from '../plugins/dynamic-island/manifest'
import { application } from '../plugins/dynamic-island/observer'
import { DEFAULT_PLUGIN_SETTINGS, applyPluginSettings, withPluginEnabled } from '../lib/plugins/enablement'
import { taskActivities } from '../plugins/dynamic-island/taskActivities'
import type { ThreadedMessage } from '../lib/threading'

let now = 100
const feed = createActivityFeed(() => now)
feed.publish({ id: 'run', source: 'sessions', title: 'Working', status: 'running' })
const snapshot = feed.getSnapshot()
now++
feed.publish({ id: 'run', source: 'sessions', title: 'Working', status: 'running' })
assert.equal(feed.getSnapshot(), snapshot, 'identical polls retain snapshot identity')
feed.publish({ id: 'error', source: 'jobs', title: 'Error', status: 'error' })
feed.publish({ id: 'input', source: 'sessions', title: 'Question', status: 'needs-input' })
assert.deepEqual(feed.getSnapshot().map(item => item.id), ['input', 'error', 'run'])
feed.dismiss('input')
feed.publish({ id: 'input', source: 'sessions', title: 'Question', status: 'needs-input' })
assert(!feed.getSnapshot().some(item => item.id === 'input'), 'same poll does not undo dismissal')
feed.publish({ id: 'input', source: 'sessions', title: 'New question', status: 'needs-input' })
assert.equal(feed.getSnapshot()[0].title, 'New question')
feed.dismiss('input')
feed.replaceSource('sessions', [])
feed.replaceSource('sessions', [{ id: 'input', source: 'sessions', title: 'New question', status: 'needs-input' }])
assert.equal(feed.getSnapshot()[0].id, 'input', 'a resolved item may recur after its previous dismissal')
const mutableTarget = { provider: 'codex' as const, providerInstanceId: 'work', sessionId: 'same' }
feed.publish({ id: 'captured', source: 'jobs', title: 'Captured target', status: 'info', target: mutableTarget })
mutableTarget.providerInstanceId = 'personal'
assert.equal(feed.getSnapshot().find(item => item.id === 'captured')?.target?.providerInstanceId, 'work', 'publisher captures immutable navigation identity')
feed.publish({ id: 'short', source: 'notices', title: 'Copied', status: 'info', expiresAt: now + 100 })
const release = feed.hold()
now += 200
feed.expire()
assert(feed.getSnapshot().some(item => item.id === 'short'), 'expanded presentation holds expiry')
release()
assert(!feed.getSnapshot().some(item => item.id === 'short'))
assert(feed.getSnapshot().some(item => item.id === 'error'), 'errors do not expire by default')

const notifications = createNotificationCenter(() => now)
let first = 0, second = 0
const unsubscribeA = notifications.subscribe(() => first++)
const unsubscribeB = notifications.subscribe(() => second++)
const id = notifications.service.show('success', 'Saved', { target: { provider: 'codex', providerInstanceId: 'work', sessionId: 'same' } })
assert.equal(first, 1); assert.equal(second, 1, 'two independent presenters receive one publication')
assert.equal(notifications.getSnapshot()[0].target?.providerInstanceId, 'work')
notifications.service.dismiss(id)
assert.equal(notifications.getSnapshot().length, 0)
notifications.service.show('info', 'Expires')
now += 6001; notifications.expire()
assert.equal(notifications.getSnapshot().length, 0)
unsubscribeA(); unsubscribeB()

const target = { provider: 'codex' as const, providerInstanceId: 'work', sessionId: 'same' }
const event = (entries: [string, 'running' | 'needs-input'][], time = now): PluginActivitySnapshot => ({ now: time, activity: new Map(entries), sessions: [
  { key: 'codex@work:same', title: 'Work', target },
  { key: 'codex@personal:same', title: 'Personal', target: { ...target, providerInstanceId: 'personal' } },
], selectedKey: null, focused: true })
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
const observed = createActivityFeed(() => now)
const host = createPluginApplicationHost('web', [manifest], { 'dynamic-island': async () => application }, { activity: observed })
await host.publish(event([]))
assert.equal(observed.getSnapshot().length, 0, 'first snapshot does not invent a finished turn')
await host.publish(event([['codex@work:same', 'running'], ['codex@personal:same', 'needs-input']]))
assert.equal(observed.getSnapshot().length, 2)
assert.equal(observed.getSnapshot()[0].target?.providerInstanceId, 'personal')
await host.publish(event([]))
assert(observed.getSnapshot().every(item => item.detail === 'Turn ended' && item.status === 'info'))
applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'dynamic-island', false))
assert.equal(observed.getSnapshot().length, 0, 'disabling removes presentation state')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
await host.publish(event([]))
assert.equal(observed.getSnapshot().length, 0, 're-enable never replays old results')
host.dispose()

const producer: PluginManifest = { apiVersion: PLUGIN_API_VERSION, id: 'notification-fixture', title: 'Fixture', description: 'Fixture', renderers: ['web'], stateVersion: 1, surfaces: [], commands: [
  { id: 'notify', label: 'Notify', category: 'View', scope: 'application', requires: null, handler: 'notify', services: ['notifications'], renderers: ['web'] },
] }
let retained: (() => void) | undefined
const commands = createPluginCommandHost('web', [producer], { 'notification-fixture': async () => ({ apiVersion: PLUGIN_API_VERSION, pluginId: producer.id, handlers: {
  notify({ services }) { services.notifications!.show('info', 'Plugin notification'); retained = () => { services.notifications!.show('info', 'Late notification') } },
} }) })
await commands.run('notify', { target: { session: null, cwd: null }, services: { notifications: notifications.service } })
assert.equal(notifications.getSnapshot().length, 1)
retained!()
assert.equal(notifications.getSnapshot().length, 1, 'settled command cannot publish late notifications')
commands.dispose()

const task = (uuid: string, subtype: string, extra = {}): ThreadedMessage => ({ role: 'system', uuid, provider: 'claude', blocks: [{ type: 'claude_system', payload: { type: 'system', subtype, task_id: 'background', description: 'Background build', ...extra } }] } as unknown as ThreadedMessage)
const transcripts = [{ owner: 'reader', target, persisted: [task('started', 'task_started')], live: { messages: [] } }]
assert.equal(taskActivities(transcripts).length, 1)
assert.equal(taskActivities(transcripts)[0].messageUuid, 'started')
assert.equal(taskActivities([{ ...transcripts[0], live: { messages: [task('done', 'task_notification', { status: 'completed' })] } }]).length, 0)
console.log('Activity island: PASS (priority, stable polls, dismissals, held expiry, notification fan-out, qualified identities, lifecycle, command fences and background task derivation)')
