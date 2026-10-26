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
const { isPluginEnabled } = await import('../../lib/plugins/enablement')
for (const width of [52, 90]) {
  let key!: (key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => void
  const setup = await testRender(<PluginManagerPopover theme={DARK_THEME} width={width} height={22} onClose={() => {}} onNotice={() => {}} onKeyHandlerReady={handler => { key = handler }} />, { width, height: 22 })
  const list = () => setup.renderer.root.findDescendantById('plugin-manager-scroll') as ScrollBoxRenderable
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); await setup.flush() }) }
  try {
    await settle()
    const frame = setup.captureCharFrame()
    assert.ok(frame.includes('transcript.'), 'description ending wraps instead of being cut off')
    assert.ok(list().scrollHeight > list().viewport.height, 'plugins overflow in a real scrollbox')
    const start = list().scrollTop
    await act(async () => { await setup.mockMouse.scroll(list().x + 5, list().y + 3, 'down') })
    await settle()
    assert.ok(list().scrollTop > start, 'wheel moves through plugins')
    await act(async () => { key({ name: 'end', sequence: '', ctrl: false, shift: false }) })
    await settle()
    assert.ok(setup.captureCharFrame().includes(PROVIDER_PLUGINS.at(-1)!.title), 'keyboard reveals final row')
    assert.ok(setup.captureCharFrame().includes('esc close'), 'footer stays visible')
    await act(async () => { key({ name: 'home', sequence: '', ctrl: false, shift: false }) })
    await settle()
    assert.ok(setup.captureCharFrame().includes(PLUGIN_MANIFESTS[0].title), 'home restores first plugin')
    const first = setup.renderer.root.findDescendantById(`plugin-row:${PLUGIN_MANIFESTS[0].id}`)!
    const enabled = isPluginEnabled(PLUGIN_MANIFESTS[0].id)
    await act(async () => { await setup.mockMouse.click(first.x + 3, first.y, 2) })
    assert.equal(isPluginEnabled(PLUGIN_MANIFESTS[0].id), enabled, 'right click does not toggle plugins')
    await act(async () => { await setup.mockMouse.click(first.x + 3, first.y) })
    assert.equal(isPluginEnabled(PLUGIN_MANIFESTS[0].id), !enabled, 'left click toggles the pointed plugin')
  } finally { await act(async () => setup.renderer.destroy()) }
}
console.log('Plugin manager mouse wheel, keyboard reveal, wrapped descriptions and fixed footer passed at narrow and wide widths')
process.exit(0)
