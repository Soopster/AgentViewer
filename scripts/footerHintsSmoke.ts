// Plugin key hints in the terminal status bar, and a repository command in a session's menu.
import assert from 'node:assert/strict'
import { parseLocalPluginManifest } from '../lib/plugins/localManifest'
import { registerLocalPluginManifests } from '../lib/plugins/catalog'
import { pluginFooterHints } from '../lib/plugins/footerHints'
import { runFooterSegments } from '../tui/opentui/app/derived/footer'
import { applyPluginSettings } from '../lib/plugins/enablement'
import { DARK_THEME } from '../tui/theme'
import { listPluginCommands } from '../lib/plugins/catalog'

const parsed = parseLocalPluginManifest({ id: 'hinter', hints: [
  { context: 'transcript', key: '⇧Q', label: 'queue', order: 2 },
  { context: 'transcript', key: '⇧W', label: 'watch', order: 1 },
  { context: 'rail', key: '⇧R', label: 'rail only' },
] }, new Set())
assert.deepEqual(parsed.problems, [])
for (const bad of [{ context: 'sidebar', key: 'a', label: 'x' }, { context: 'rail', key: 'toolongkey1', label: 'x' }, { context: 'rail', key: 'a', label: 'x'.repeat(25) }, { context: 'rail', key: '', label: 'x' }]) {
  assert.ok(parseLocalPluginManifest({ id: 'bad', hints: [bad] }, new Set()).problems.length, JSON.stringify(bad))
}
registerLocalPluginManifests([parsed.manifest!])
assert.deepEqual(pluginFooterHints('transcript'), [['⇧W', 'watch'], ['⇧Q', 'queue']], 'ordered, and only the pane\'s own context')
assert.deepEqual(pluginFooterHints('rail'), [['⇧R', 'rail only']])
assert.deepEqual(pluginFooterHints('composer'), [])

const bar = (width: number, over: Partial<Parameters<typeof runFooterSegments>[0]> = {}) => runFooterSegments({
  composerActive: false, composerKeysTargetTurn: false, effectiveFocus: 'messages', sidebarView: 'sessions', isScrollbackView: false, scrollbackExpanded: false,
  commandChordPending: false, theme: DARK_THEME, splitChordPending: false, attentionNeedsInputCount: 0, width, statusBarInDock: false, composerDockTextareaWidth: 80, ...over,
}).map(segment => segment.text).join('')
const wide = bar(140)
assert.ok(wide.includes('⇧W watch') && wide.includes('⇧Q queue'), 'the hints show when there is room')
assert.ok(wide.indexOf('⌃K commands') < wide.indexOf('⇧W watch'), 'host keys come first')
assert.ok(!wide.includes('rail only'), 'a rail hint does not show in the transcript')
const narrow = bar(40)
assert.ok(narrow.includes('⌃K commands') && !narrow.includes('⇧W'), 'a narrow bar drops the plugin hints, never the host keys')
assert.ok(bar(220, { effectiveFocus: 'sessions' }).includes('⇧R rail only'))

applyPluginSettings({ version: 1, disabled: ['hinter'] })
assert.ok(!bar(140).includes('⇧W watch'), 'a disabled plugin shows no hints')
applyPluginSettings({ version: 1, disabled: [] })

// The session context menu offers repository commands that ask for it, not a hard-coded plugin.
assert.deepEqual(listPluginCommands('tui').filter(command => command.sessionMenu).map(command => command.id), ['checkpoints'])
console.log('footer hints smoke passed')
