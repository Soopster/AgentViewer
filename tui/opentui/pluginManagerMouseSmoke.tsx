/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ScrollBoxRenderable } from '@opentui/core'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
process.chdir(mkdtempSync(join(tmpdir(), 'plugins-mouse-')))
const { PluginManagerPopover } = await import('./PluginManagerPopover')
const { PLUGIN_MANIFESTS } = await import('../../lib/plugins/catalog')
const { PROVIDER_PLUGINS } = await import('../../lib/plugins/providerPlugins')
const { filterPluginManagerEntries } = await import('../../lib/plugins/managerSearch')
const sorted = filterPluginManagerEntries([...PLUGIN_MANIFESTS, ...PROVIDER_PLUGINS], '')
const { isPluginEnabled, readPluginSettings } = await import('../../lib/plugins/enablement')
for (const width of [52, 90]) {
  let key!: (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void
  const setup = await testRender(<PluginManagerPopover theme={DARK_THEME} width={width} height={22} onClose={() => {}} onNotice={() => {}} onKeyHandlerReady={handler => { key = handler }} />, { width, height: 22 })
  const list = () => setup.renderer.root.findDescendantById('plugin-manager-scroll') as ScrollBoxRenderable
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); await setup.flush() }) }
  try {
    await settle()
    const frame = setup.captureCharFrame()
    assert.ok(frame.includes(sorted[0].description.split(' ').at(-1)!), 'description ending wraps instead of being cut off')
    assert.ok(list().scrollHeight > list().viewport.height, 'plugins overflow in a real scrollbox')
    const start = list().scrollTop
    await act(async () => { await setup.mockMouse.scroll(list().x + 5, list().y + 3, 'down') })
    await settle()
    assert.ok(list().scrollTop > start, 'wheel moves through plugins')
    await act(async () => { key({ name: 'end', sequence: '', ctrl: false, shift: false }) })
    await settle()
    assert.ok(setup.captureCharFrame().includes(sorted.at(-1)!.title), 'keyboard reveals final alphabetical row')
    assert.ok(setup.captureCharFrame().includes('esc close'), 'footer stays visible')
    await act(async () => { key({ name: 'home', sequence: '', ctrl: false, shift: false }) })
    await settle()
    assert.ok(setup.captureCharFrame().includes(sorted[0].title), 'home restores first alphabetical plugin')
    const first = setup.renderer.root.findDescendantById(`plugin-row:${sorted[0].id}`)!
    const enabled = isPluginEnabled(sorted[0].id)
    await act(async () => { await setup.mockMouse.click(first.x + 3, first.y, 2) })
    assert.equal(isPluginEnabled(sorted[0].id), enabled, 'right click does not toggle plugins')
    await act(async () => { await setup.mockMouse.click(first.x + 3, first.y) })
    assert.equal(isPluginEnabled(sorted[0].id), !enabled, 'left click toggles the pointed plugin')
    const press = async (name: string, sequence = name, ctrl = false) => { await act(async () => { key({ name, sequence, ctrl, shift: false }) }); await settle() }
    await press('/')
    for (const char of 'analytics') await press(char)
    assert.ok(setup.captureCharFrame().includes('Session analytics'), 'search reveals matching plugin')
    assert.equal(setup.renderer.root.findDescendantById(`plugin-row:${sorted[0].id}`), undefined, 'search removes unrelated rows')
    await press('return')
    const analyticsOn = isPluginEnabled('analytics')
    await press('space', ' ')
    assert.equal(isPluginEnabled('analytics'), !analyticsOn, 'keyboard toggles the filtered plugin, not its old row index')
    await press('2')
    assert.equal(!!setup.renderer.root.findDescendantById('plugin-row:analytics'), !analyticsOn, 'Enabled filter combines with search')
    await press('3')
    assert.equal(!!setup.renderer.root.findDescendantById('plugin-row:analytics'), analyticsOn, 'Disabled filter combines with search')
    await press(isPluginEnabled('analytics') ? '2' : '3')
    await press('space', ' ')
    assert.equal(setup.renderer.root.findDescendantById('plugin-row:analytics'), undefined, 'toggled plugin leaves its previous enablement filter immediately')
    const all = setup.renderer.root.findDescendantById('plugin-filter:all')!
    await act(async () => { await setup.mockMouse.click(all.x + 1, all.y) })
    await settle()
    assert.ok(setup.renderer.root.findDescendantById('plugin-row:analytics'), 'clicking All restores the filtered plugin')
    await press('/')
    await press('u', 'u', true)
    for (const char of 'no-plugin-has-this-name') await press(char)
    assert.ok(setup.captureCharFrame().includes('No matching plugins.'), 'empty result is explicit')
    await press('return')
    const before = readPluginSettings()
    await press('space', ' ')
    assert.deepEqual(readPluginSettings(), before, 'empty result cannot toggle a stale selection')
    await press('u', 'u', true)
    assert.ok(setup.captureCharFrame().includes(sorted[0].title), 'clearing search restores the full catalog')
  } finally { await act(async () => setup.renderer.destroy()) }
}
console.log('Plugin manager mouse wheel, keyboard reveal, wrapped descriptions and fixed footer passed at narrow and wide widths')
process.exit(0)
