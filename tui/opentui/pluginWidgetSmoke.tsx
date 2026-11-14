/** @jsxImportSource @opentui/react */
// Widget contributions: a corner slot loads an enabled plugin's widget, a
// widget draws only what it has to say, and turning the plugin off takes it
// off screen without touching the feed behind it.
import assert from 'node:assert/strict'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { PluginWidgetHost } from './shell/PluginWidgetHost'
import { tuiPluginWidgets } from './shell/widgetPlugins'
import { listPluginWidgets } from '../../lib/plugins/widgetHost'
import { PLUGIN_MANIFESTS } from '../../lib/plugins/catalog'
import { applyPluginSettings, DEFAULT_PLUGIN_SETTINGS, withPluginEnabled } from '../../lib/plugins/enablement'
import { beginPiActivity, completePiActivity, getPiActivitySnapshot } from '../../lib/piActivity'

assert.deepEqual(listPluginWidgets('tui', PLUGIN_MANIFESTS, 'corner').map(spec => `${spec.pluginId}:${spec.id}`), ['pi-activity:pi-activity'])
assert.equal(tuiPluginWidgets.isLoaded('pi-activity'), false, 'listing widgets loaded one')

const setup = await testRender(<PluginWidgetHost slot="corner" theme={DARK_THEME} width={120} height={30} zIndex={48} />, { width: 120, height: 30 })
const settle = async (ms = 80) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); await setup.flush() }) }
const screen = () => setup.captureCharFrame()
try {
  await settle(150)
  assert(tuiPluginWidgets.isLoaded('pi-activity'), 'the corner slot did not load the enabled widget')
  assert(!screen().includes('Pi activity'), 'an idle widget drew something')

  let token = ''
  await act(async () => { token = beginPiActivity('widget-smoke', 'Loading Pi extensions') })
  await settle()
  assert(screen().includes('Pi activity') && screen().includes('Loading Pi extensions'), `the active widget did not draw:\n${screen()}`)

  await act(async () => { applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'pi-activity', false)) })
  await settle()
  assert(!screen().includes('Pi activity'), 'a disabled plugin kept its widget on screen')
  assert(!tuiPluginWidgets.isLoaded('pi-activity'), 'disabling did not evict the widget module')
  assert(getPiActivitySnapshot().active, 'disabling the widget stopped the feed behind it')

  await act(async () => { applyPluginSettings(DEFAULT_PLUGIN_SETTINGS) })
  await settle(150)
  assert(screen().includes('Loading Pi extensions'), 'a re-enabled widget did not come back')
  await act(async () => { completePiActivity(token) })
  await settle()
  assert(!screen().includes('Pi activity'), 'a finished widget stayed up')
  console.log('Plugin widgets: lazy corner slot, draw-on-demand, disable evicts without stopping the feed, re-enable restores.')

  // A mod's widget: content from its server module, drawn by the shell, refreshed on its interval.
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const dir = mkdtempSync(path.join(tmpdir(), 'mod-widgets-'))
  mkdirSync(path.join(dir, 'build-light'))
  writeFileSync(path.join(dir, 'build-light', 'plugin.json'), JSON.stringify({ id: 'build-light', title: 'Build light', widgets: [{ id: 'status', refreshMs: 1000 }, { id: 'broken' }, { id: 'hangs' }] }))
  writeFileSync(path.join(dir, 'build-light', 'server.mjs'), `let n = 0
export const widgets = {
  status: () => ({ title: 'CI', text: 'build #' + (++n) + ' green', tone: 'success' }),
  broken: () => { throw new Error('widget fixture failure') },
  hangs: () => new Promise(() => {}),
}`)
  process.env.AGENT_VIEWER_PLUGINS_DIR = dir
  const { resetLocalPluginDiscovery } = await import('../../lib/plugins/localPlugins')
  resetLocalPluginDiscovery()
  const originalError = console.error
  console.error = () => {}
  try {
    const { installTuiLocalPlugins } = await import('./shell/localPlugins')
    await act(async () => { installTuiLocalPlugins() })
    await settle(2600)
    assert(/CI/.test(screen()) && /build #\d+ green/.test(screen()), `the mod widget did not draw:\n${screen()}`)
    const first = Number(/build #(\d+)/.exec(screen())![1])
    // A hanging widget costs each round at most its 2s timeout, never the others' content.
    await settle(3200)
    assert(Number(/build #(\d+)/.exec(screen())![1]) > first, 'the mod widget did not refresh')
    await act(async () => { applyPluginSettings(withPluginEnabled(DEFAULT_PLUGIN_SETTINGS, 'build-light', false)) })
    await settle(300)
    assert(!/build #/.test(screen()), 'a disabled mod kept its widget on screen')
    await act(async () => { applyPluginSettings(DEFAULT_PLUGIN_SETTINGS) })
  } finally { console.error = originalError }
  console.log('Mod widgets: content from a mod server module is drawn and refreshed; a failing or hanging widget is skipped; disabling hides it.')
} finally {
  act(() => setup.renderer.destroy())
}
process.exit(0)
