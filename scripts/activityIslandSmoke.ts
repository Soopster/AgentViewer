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
const replies: [string, string, string][] = []
const gitReads: string[] = []
let git: { branch: string; modified: number; untracked: number; stashes: number } | null = { branch: 'main', modified: 2, untracked: 1, stashes: 0 }
let proof: import('../lib/plugins/proof').ProofSnapshot | null = null
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
const observed = createActivityFeed(() => now)
const host = createPluginApplicationHost('web', [manifest], { 'dynamic-island': async () => application }, { activity: observed, repository: { readGit: async cwd => { gitReads.push(cwd); return git }, readProof: async () => proof }, permissions: { respond: async (to, id, response) => { replies.push([to.providerInstanceId ?? '', id, response]) } } })
await host.publish(event([]))
assert.equal(observed.getSnapshot().length, 0, 'first snapshot does not invent a finished turn')
await host.publish(event([['codex@work:same', 'running'], ['codex@personal:same', 'needs-input']]))
assert.equal(observed.getSnapshot().length, 2)
assert.equal(observed.getSnapshot()[0].target?.providerInstanceId, 'personal')
await host.publish(event([]))
assert(observed.getSnapshot().every(item => item.detail === 'Turn ended' && item.status === 'info'))
// Approvals: one row per ask, replacing the session's bare "Needs input"; Reject leads when the ask must not be one keystroke from approved.
const ask = (id: string, extra = {}) => ({ id, title: 'Run command', toolName: 'Bash', command: 'rm -rf build', provider: 'codex' as const, sessionId: 'same', ...extra })
const withAsks = (asks: ReturnType<typeof ask>[]): PluginActivitySnapshot => ({ ...event([['codex@work:same', 'needs-input']]), pending: new Map([['codex@work:same', asks]]) })
await host.publish(withAsks([ask('p1'), ask('p2', { defaultToDeny: true }), ask('q1', { questions: [{ question: 'Which?', header: 'h', options: [], multiSelect: false }] })]))
const rows = observed.getSnapshot()
assert.equal(rows.filter(item => item.kind === 'approval').length, 2)
assert.equal(rows.filter(item => item.kind === 'question').length, 1)
assert(!rows.some(item => item.id === 'session:codex@work:same'), 'listed asks replace the generic needs-input row')
const plain = rows.find(item => item.id.endsWith(':p1'))!
assert.match(plain.detail!, /Bash: rm -rf build/)
assert.deepEqual(plain.actions!.map(action => [action.id, action.tone]), [['reject', 'danger'], ['approve', 'primary']])
const guarded = rows.find(item => item.id.endsWith(':p2'))!
assert.deepEqual(guarded.actions!.map(action => [action.id, action.tone]), [['reject', 'primary'], ['approve', undefined]], 'defaultToDeny leads with reject')
assert.equal(rows.find(item => item.kind === 'question')!.actions!.length, 0, 'a question cannot be approved from the island')
await plain.actions!.find(action => action.id === 'approve')!.run()
assert.deepEqual(replies, [['work', 'p1', 'once']])
await host.publish(withAsks([ask('p2', { defaultToDeny: true })]))
assert.equal(observed.getSnapshot().filter(item => item.kind === 'approval').length, 1, 'an ask answered elsewhere leaves the feed')
await host.publish(event([['codex@work:same', 'needs-input']]))
assert.equal(observed.getSnapshot().filter(item => item.kind === 'approval').length, 0)
assert(observed.getSnapshot().some(item => item.id === 'session:codex@work:same'), 'a session with no listed ask keeps its generic row')
// Team: only waiting teammates raise a row; finished results alone are history.
await host.publish({ ...event([]), teams: new Map([['codex@work:same', { waiting: 2, finished: 1 }], ['codex@personal:same', { waiting: 0, finished: 3 }]]) })
const team = observed.getSnapshot().filter(item => item.kind === 'team')
assert.equal(team.length, 1)
assert.match(team[0].title, /Work: 2 teammates waiting on you/)
assert.equal(team[0].target?.providerInstanceId, 'work')
// A dismissed team row stays dismissed while only its wording drifts (reviewed results, a retitled session), and returns when more teammates wait.
observed.dismiss(team[0].id)
await host.publish({ ...event([]), teams: new Map([['codex@work:same', { waiting: 2, finished: 0 }]]) })
assert.equal(observed.getSnapshot().filter(item => item.kind === 'team').length, 0, 'reviewing results does not revive a dismissed row')
await host.publish({ ...event([]), sessions: [{ key: 'codex@work:same', title: 'Renamed', target }], teams: new Map([['codex@work:same', { waiting: 2, finished: 1 }]]) })
assert.equal(observed.getSnapshot().filter(item => item.kind === 'team').length, 0, 'a retitled session does not revive it')
await host.publish({ ...event([]), teams: new Map([['codex@work:same', { waiting: 3, finished: 1 }]]) })
assert.equal(observed.getSnapshot().filter(item => item.kind === 'team').length, 1, 'another waiting teammate does')
await host.publish({ ...event([]), teams: new Map() })
assert.equal(observed.getSnapshot().filter(item => item.kind === 'team').length, 0, 'a resolved team leaves the feed')
// Health: a long running turn is flagged from the host's start time, never a waiting one, and the row is stable between polls.
const longRun = (at: number): PluginActivitySnapshot => ({ ...event([['codex@work:same', 'running'], ['codex@personal:same', 'waiting' as never]], at), started: new Map([['codex@work:same', at - 25 * 60_000], ['codex@personal:same', at - 90 * 60_000]]) })
await host.publish(longRun(now))
const health = observed.getSnapshot().filter(item => item.kind === 'health')
assert.equal(health.length, 1, 'a waiting turn is not flagged')
assert.match(health[0].title, /Work has run 25m/)
const stable = observed.getSnapshot()
await host.publish(longRun(now + 60_000))
assert.equal(observed.getSnapshot().filter(item => item.kind === 'health')[0].title, health[0].title, 'text is bucketed so polls stay identical')
assert.equal(observed.getSnapshot(), stable, 'identical health rows keep snapshot identity')
await host.publish({ ...event([['codex@work:same', 'running']], now + 120_000), started: new Map([['codex@work:same', now + 120_000 - 5 * 60_000]]) })
assert.equal(observed.getSnapshot().filter(item => item.kind === 'health').length, 0, 'a short turn is not flagged')
// Repo & checks: read once per cwd, only while the app is in front, derived again on every snapshot.
const check = { id: 'tsc', label: 'Typecheck', executable: 'npx', args: ['tsc'], cwd: '/work/app', timeoutMs: 1000 }
proof = { cwd: '/work/app', config: { version: '1', checks: [check] }, suggestions: [], fingerprint: 'f', runs: [{ id: 'r', cwd: '/work/app', createdAt: 1, finishedAt: 2, configVersion: '1', results: [{ check, status: 'failed', exitCode: 1, before: 'f', after: 'f' }] }] }
const inRepo = (over: Partial<PluginActivitySnapshot> = {}): PluginActivitySnapshot => ({ ...event([]), cwd: '/work/app', selectedKey: 'codex@work:same', ...over })
await host.publish(inRepo({ focused: false }))
assert.deepEqual(gitReads, [], 'an unfocused app reads nothing')
await host.publish(inRepo())
await new Promise(resolve => setTimeout(resolve, 0))
await host.publish(inRepo())
assert.deepEqual(gitReads, ['/work/app'], 'one read per directory')
const repoRows = observed.getSnapshot().filter(item => item.kind === 'checks' || item.kind === 'repo')
assert.deepEqual(repoRows.map(item => item.kind).sort(), ['checks', 'repo'])
assert.match(repoRows.find(item => item.kind === 'checks')!.title, /1 check failing in app/)
assert.match(repoRows.find(item => item.kind === 'repo')!.title, /3 uncommitted changes on main/)
await host.publish(inRepo({ ...event([['codex@work:same', 'running']]), cwd: '/work/app', selectedKey: 'codex@work:same' }))
assert(!observed.getSnapshot().some(item => item.kind === 'repo'), 'a dirty tree is quiet while a turn is editing it')
await host.publish(inRepo({ cwd: null }))
assert(!observed.getSnapshot().some(item => item.kind === 'checks' || item.kind === 'repo'), 'no project, no repo rows')
// Kind ranks within a status.
const ranked = createActivityFeed(() => now)
ranked.publish({ id: 'a', source: 's', status: 'needs-input', title: 'a', kind: 'health' })
ranked.publish({ id: 'b', source: 's', status: 'needs-input', title: 'b', kind: 'approval', updatedAt: 0 })
assert.deepEqual(ranked.getSnapshot().map(item => item.id), ['b', 'a'], 'approval outranks health at equal status')
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
