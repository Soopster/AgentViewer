import assert from 'node:assert/strict'
import { createPluginCommandHost } from '../lib/plugins/commandHost'
import { PLUGIN_API_VERSION, type PluginManifest } from '../lib/plugins/types'
import type { PluginCommandModule, PluginCommandServices, PluginCommandTarget } from '../lib/plugins/commands'
import { DEFAULT_PLUGIN_SETTINGS, applyPluginSettings } from '../lib/plugins/enablement'
import { commands } from '../plugins/composer-tools/commands'
import { manifest } from '../plugins/composer-tools/manifest'
import type { ThreadedMessage } from '../lib/threading'

const target = (instance = 'personal'): PluginCommandTarget => ({ session: { sessionId: 'same', provider: 'codex', providerInstanceId: instance }, cwd: '/fixture' })
const user = (text: string): ThreadedMessage => ({ role: 'user', uuid: text, blocks: [{ type: 'text', text }] })
const written: string[] = []
const services: PluginCommandServices = { transcript: { read: async () => [user('first'), { role: 'assistant', uuid: 'assistant', blocks: [{ type: 'text', text: 'ignore' }] }, user('last')] }, composer: { replaceText: text => written.push(text), insertText: text => written.push(text) } }
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
let loads = 0
const host = createPluginCommandHost('web', [manifest], { 'composer-tools': async () => { loads++; return commands } })
assert.equal(loads, 0)
await host.run('reuse', { target: target(), services })
assert.deepEqual(written, ['last'])
assert.equal(loads, 1)
await assert.rejects(host.run('reuse', { target: { session: null, cwd: null }, services }), /needs a session/)
await assert.rejects(host.run('reuse', { target: target(), services: {} }), /needs command services/)
applyPluginSettings({ version: 1, disabled: ['composer-tools'] })
await assert.rejects(host.run('reuse', { target: target(), services }), (error: Error) => error.name === 'AbortError')
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
await host.run('reuse', { target: target(), services })
assert.equal(loads, 2)
host.dispose()

const scopedManifest: PluginManifest = { ...manifest, id: 'scoped', commands: [
  { ...manifest.commands[0], id: 'app', handler: 'app', scope: 'application', requires: null, services: ['notices'] },
  { ...manifest.commands[0], id: 'repo', handler: 'repo', scope: 'repository', requires: 'repository', services: ['notices'] },
] }
const scopedNotices: string[] = []
const scoped = createPluginCommandHost('web', [scopedManifest], { scoped: async () => ({
  apiVersion: PLUGIN_API_VERSION, pluginId: 'scoped', handlers: {
    app: context => context.services.notices!.show('info', context.target.session ? 'wrong' : 'application'),
    repo: context => context.services.notices!.show('info', context.target.cwd!),
  },
}) })
const notices = { notices: { show: (_kind: 'info' | 'error', text: string) => { scopedNotices.push(text) } } }
await scoped.run('app', { target: { session: null, cwd: null }, services: notices })
await assert.rejects(scoped.run('repo', { target: { session: null, cwd: null }, services: notices }), /needs a repository/)
await scoped.run('repo', { target: { session: null, cwd: '/repository' }, services: notices })
assert.deepEqual(scopedNotices, ['application', '/repository'])
scoped.dispose()

const fixture: PluginManifest = { ...manifest, id: 'fixture', commands: [{ ...manifest.commands[0], id: 'act', handler: 'act' }] }
let deferred = 0
let lateWrite: (() => void) | undefined
const concurrent = createPluginCommandHost('tui', [fixture], { fixture: async () => ({
  apiVersion: PLUGIN_API_VERSION, pluginId: 'fixture', handlers: {
    async act(context) {
      context.defer(() => { deferred++ })
      assert.equal(Object.isFrozen(context.target.session), true)
      assert.equal('summary' in context.target.session!, false, 'target contains identity only')
      assert.equal(context.services.notices, undefined, 'undeclared capabilities are absent')
      const messages = await context.services.transcript!.read(context.signal)
      const text = messages[0].blocks[0]
      if (text.type === 'text') context.services.composer!.replaceText(`${context.target.session!.providerInstanceId}:${text.text}`)
      lateWrite = () => context.services.composer!.replaceText('late')
    },
  },
}) })
const a = new AbortController()
let releaseA!: (messages: ThreadedMessage[]) => void
let started!: () => void
const ready = new Promise<void>(resolve => { started = resolve })
const pendingA = concurrent.run('act', { target: { ...target(), session: { ...target().session!, summary: 'private state' } as never }, signal: a.signal, services: {
  ...services, notices: { show() { throw new Error('undeclared') } },
  transcript: { read: () => { started(); return new Promise(resolve => { releaseA = resolve }) } },
} })
await ready
a.abort()
await assert.rejects(pendingA, (error: Error) => error.name === 'AbortError')
await concurrent.run('act', { target: target('work'), services: { ...services, transcript: { read: async () => [user('work prompt')] } } })
assert.equal(written.at(-1), 'work:work prompt')
releaseA([user('stale')])
await Promise.resolve()
lateWrite!()
assert.equal(written.at(-1), 'work:work prompt', 'retained capabilities cannot write after completion')
assert.equal(deferred, 2)
concurrent.dispose()

// Missing/malformed modules fail locally; loads remain retryable.
for (const module of [
  { apiVersion: 0, pluginId: 'fixture', handlers: {} },
  { apiVersion: PLUGIN_API_VERSION, pluginId: 'other', handlers: {} },
  { apiVersion: PLUGIN_API_VERSION, pluginId: 'fixture', handlers: {} },
]) {
  const invalid = createPluginCommandHost('web', [fixture], { fixture: async () => module as PluginCommandModule })
  await assert.rejects(invalid.run('act', { target: target(), services }), /mismatch|handler/)
  invalid.dispose()
}
let began!: () => void
let resolveLoad!: (module: PluginCommandModule) => void
const importing = new Promise<void>(resolve => { began = resolve })
const pendingHost = createPluginCommandHost('web', [manifest], {
  'composer-tools': () => { began(); return new Promise(resolve => { resolveLoad = resolve }) },
})
const pending = pendingHost.run('reuse', { target: target(), services })
await importing
applyPluginSettings({ version: 1, disabled: ['composer-tools'] })
await assert.rejects(pending, (error: Error) => error.name === 'AbortError')
resolveLoad(commands)
await Promise.resolve()
assert.equal(pendingHost.isLoaded('composer-tools'), false)
pendingHost.dispose()
applyPluginSettings(DEFAULT_PLUGIN_SETTINGS)
console.log('Plugin executable commands: PASS (lazy reuse, target capture, capability filtering, concurrent account isolation, cancellation, late-write suppression, validation and disable races)')
