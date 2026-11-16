// `@` mention providers, context-scoped plugin keys, and rail-menu command dispatch.
import assert from 'node:assert/strict'
import { parseLocalPluginManifest } from '../lib/plugins/localManifest'
import { MENTION_RESULTS_PER_PROVIDER, registerMentionProvider, searchMentionProviders, syncMentionsFrom } from '../lib/plugins/mentionProviders'
import { applyPluginSettings } from '../lib/plugins/enablement'
import { pluginKeyContextLive, pluginKeyIsBindable } from '../tui/opentui/app/pluginCommands'
import { dispatchPluginCommand, dispatchPluginCommandWhenShown, subscribePluginCommands } from '../lib/plugins/commandBus'

// Declared mentions: a fixed list matched by what is typed, inserting plain text.
const parsed = parseLocalPluginManifest({ id: 'tracker', mentions: [{ id: 'tickets', items: [
  { name: 'TICKET-1 Login bug', detail: 'open', insert: 'TICKET-1 login' }, { name: 'TICKET-2 Billing', detail: 'closed' }, { name: 'Roadmap' },
] }] }, new Set())
assert.deepEqual(parsed.problems, [])
for (const bad of [{ id: 'x', items: [] }, { id: 'x', items: [{ name: '' }] }, { id: 'x', items: [{ name: 'a'.repeat(61) }] }, { id: 'X', items: [{ name: 'a' }] }, { id: 'x', items: Array.from({ length: 201 }, (_, index) => ({ name: `n${index}` })) }]) {
  assert.ok(parseLocalPluginManifest({ id: 'bad', mentions: [bad] }, new Set()).problems.length, JSON.stringify(bad).slice(0, 40))
}
syncMentionsFrom([parsed.manifest!])
const found = await searchMentionProviders('tick')
assert.deepEqual(found.map(entry => entry.insert), ['TICKET-1-login', 'TICKET-2-Billing'], 'matches by name; spaces in an insert become dashes; a name is the default insert')
assert.equal(found[0]!.kind, 'plugin')
assert.deepEqual((await searchMentionProviders('closed')).map(entry => entry.name), ['TICKET-2 Billing'], 'detail matches too')
assert.equal((await searchMentionProviders('')).length, 3)
applyPluginSettings({ version: 1, disabled: ['tracker'] })
syncMentionsFrom([parsed.manifest!])
assert.deepEqual(await searchMentionProviders(''), [], 'a disabled plugin offers nothing')
applyPluginSettings({ version: 1, disabled: [] })
syncMentionsFrom([])
assert.deepEqual(await searchMentionProviders(''), [], 'withdrawn with its plugin')

// Code providers are bounded and cannot break the menu.
const many = registerMentionProvider({ id: 'many', search: () => Array.from({ length: 50 }, (_, index) => ({ kind: 'plugin' as const, provider: 'many', name: `n${index}`, insert: `n${index}` })) })
const broken = registerMentionProvider({ id: 'broken', search: () => { throw new Error('boom') } })
const rejects = registerMentionProvider({ id: 'rejects', search: () => Promise.reject(new Error('no')) })
const hostile = registerMentionProvider({ id: 'hostile', search: () => [{ kind: 'plugin', provider: 'x', name: '', insert: '' }, { kind: 'plugin', provider: 'x', name: 'a\nb\u0007c', insert: 'a b' }] })
const results = await searchMentionProviders('')
assert.equal(results.filter(entry => entry.provider === 'many').length, MENTION_RESULTS_PER_PROVIDER)
assert.deepEqual(results.filter(entry => entry.provider === 'hostile').map(entry => [entry.name, entry.insert]), [['a b c', 'a-b']], 'empty entries dropped, control characters flattened')
many(); broken(); rejects(); hostile()

// Key contexts: where a plugin's key is live; a composer key must be a ⌃ chord.
const live = (context: Parameters<typeof pluginKeyContextLive>[0], composerActive: boolean, effectiveFocus: string) => pluginKeyContextLive(context, { composerActive, effectiveFocus })
assert.ok(live(undefined, true, 'messages') && live(undefined, false, 'sessions'))
assert.ok(live('navigation', false, 'sessions') && !live('navigation', true, 'messages'))
assert.ok(live('rail', false, 'sessions') && !live('rail', false, 'messages') && !live('rail', true, 'sessions'))
assert.ok(live('transcript', false, 'messages') && !live('transcript', false, 'sessions') && !live('transcript', true, 'messages'))
assert.ok(live('composer', true, 'messages') && !live('composer', false, 'messages'))
assert.ok(!pluginKeyIsBindable({ tuiKey: { name: 'x' }, tuiKeyContext: 'composer' }), 'a bare letter in the composer would swallow typing')
assert.ok(pluginKeyIsBindable({ tuiKey: { name: 'x', ctrl: true }, tuiKeyContext: 'composer' }))
assert.ok(pluginKeyIsBindable({ tuiKey: { name: 'x' }, tuiKeyContext: 'rail' }))

// A rail menu opens a session and then asks for a command: it is retried until the session's view handles it.
const target = { provider: 'claude', sessionId: 's1' } as never
let handled = 0
const stopEarly = dispatchPluginCommandWhenShown('analytics', target, undefined, 20, 5)
await new Promise(resolve => setTimeout(resolve, 12))
const unsubscribe = subscribePluginCommands((id) => { handled++; return id === 'analytics' })
await new Promise(resolve => setTimeout(resolve, 30))
assert.equal(handled, 1, 'delivered once the view appeared, and not again')
stopEarly(); unsubscribe()
let never = 0
const stopGivingUp = subscribePluginCommands(() => { never++; return false })
dispatchPluginCommandWhenShown('analytics', target, undefined, 3, 2)
await new Promise(resolve => setTimeout(resolve, 30))
assert.equal(never, 3, 'gives up after its attempts')
stopGivingUp()
assert.equal(dispatchPluginCommand('analytics'), false)
console.log('composer extensions smoke passed')
