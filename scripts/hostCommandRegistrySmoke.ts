// The palette's own commands are registrations (tui/opentui/app/actions/palette/*), not one switch.
import assert from 'node:assert/strict'
import { getPluginCommand } from '../lib/plugins/catalog'
import { COMMANDS } from '../tui/opentui/app/commands'
import { hostCommandIds, registerHostCommand, resolveHostCommand } from '../tui/opentui/app/actions/hostCommands'
import '../tui/opentui/app/actions/commandPalette'

// Every command in the palette resolves: to a plugin command, a prefix the palette expands, a host handler, or the few the root handles first.
// Handled by the root before the palette dispatches (view-studio-*, view:<custom view>, engineering-view), or listed for
// their key hint only and bound elsewhere (the surface panel's own keys); running them from the palette has never done anything.
const ROOT_HANDLED = /^(view-studio-|view:|engineering-view$)/
const KEY_HINT_ONLY = ['surface-panel', 'surface-add', 'surface-cycle', 'surface-expand', 'surface-narrow', 'surface-wide']
const unresolved = COMMANDS.filter(command => !getPluginCommand(command.id) && !resolveHostCommand(command.id)
  && !/^(popwin:|panelwin:)/.test(command.id) && !ROOT_HANDLED.test(command.id)).map(command => command.id)
assert.deepEqual(unresolved, KEY_HINT_ONLY, 'a palette entry has no handler')
assert.ok(hostCommandIds().length >= 127, 'the host registers its commands')

// Dispatch runs the handler with the shared context, destructuring only what the command uses.
const calls: string[] = []
const ctx = new Proxy({}, { get: (_target, name) => (...args: unknown[]) => { calls.push(`${String(name)}(${args.length})`) } }) as never
const locals = { persistPreference: (write: () => Promise<unknown>) => write(), focusedSession: null }
resolveHostCommand('quit')!(ctx, 'quit', locals)
assert.deepEqual(calls, ['requestExit(0)'])
calls.length = 0
resolveHostCommand('refresh')!(ctx, 'refresh', locals)
assert.deepEqual(calls, ['refreshSessions(1)', 'refreshSelectedSessionDetail(2)'])
calls.length = 0
// One handler may serve several ids and tell them apart by id.
assert.equal(resolveHostCommand('tabs-horizontal'), resolveHostCommand('tabs-vertical'))

// A later registration takes over an id and unregistering gives the built-in back.
const builtIn = resolveHostCommand('quit')
let intercepted = 0
const stop = registerHostCommand(['quit'], () => { intercepted++ })
resolveHostCommand('quit')!(ctx, 'quit', locals)
assert.equal(intercepted, 1)
stop()
assert.equal(resolveHostCommand('quit'), builtIn)
assert.equal(resolveHostCommand('no-such-command'), null)
console.log('host command registry smoke passed')
