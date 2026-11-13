/** @jsxImportSource @opentui/react */
// A mod's interactive view in the real App: ⌃K x opens Mod views, the view a
// mod returned as data is drawn, Enter and a click run the mod's actions, and
// the view re-renders with the result and shows the action's notice.
import React from 'react'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testRender, act } from './testRender'

const workspace = mkdtempSync(path.join(tmpdir(), 'mod-views-'))
const plugins = path.join(workspace, 'mods')
mkdirSync(path.join(plugins, 'counter'), { recursive: true })
writeFileSync(path.join(plugins, 'counter', 'plugin.json'), JSON.stringify({ id: 'counter', title: 'Counter', views: [{ id: 'tally', title: 'Tally' }, { id: 'gauge', title: 'Gauge', component: true }] }))
// A bespoke component: a plain ES module importing nothing, built with the app's React.
writeFileSync(path.join(plugins, 'counter', 'tui.mjs'), `
export function views({ React }) {
  const h = React.createElement
  function Gauge({ run, registerKeys, theme, width }) {
    const [level, setLevel] = React.useState(3)
    React.useEffect(() => {
      registerKeys((key) => {
        if (key.sequence === '+') { setLevel(value => value + 1); return true }
        if (key.sequence === 'b') { void run('bump', 'apples'); return true }
        return false
      })
      return () => registerKeys(null)
    }, [])
    return h('box', { flexDirection: 'column' },
      h('text', { fg: theme.cyan }, 'GAUGE ' + '#'.repeat(level) + ' level ' + level),
      h('text', { fg: theme.dim }, 'width ' + width))
  }
  return { gauge: Gauge }
}`)
writeFileSync(path.join(plugins, 'counter', 'server.mjs'), `
const counts = { apples: 0, pears: 0 }
export const views = {
  tally: () => ({ title: 'Fruit tally', blocks: [
    { type: 'heading', text: 'Counts' },
    ...Object.entries(counts).map(([id, n]) => ({ type: 'item', id, label: id, detail: 'count ' + n, action: 'bump' })),
    { type: 'button', action: 'reset', label: 'Reset' },
  ] }),
}
export const actions = {
  bump: ({ item }) => { counts[item]++; return { notice: 'bumped ' + item } },
  reset: () => { counts.apples = 0; counts.pears = 0; return { notice: 'reset' } },
}`)
process.env.AGENT_VIEWER_PLUGINS_DIR = plugins
process.env.AGENT_VIEWER_PLUGIN_SETTINGS = path.join(workspace, 'plugin-settings.json')
process.chdir(workspace)
const { installTuiLocalPlugins } = await import('./shell/localPlugins')
installTuiLocalPlugins()
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 140, height: 40, kittyKeyboard: true })
const settle = async (ms = 200) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) }); await act(async () => { await setup.flush() }) }
const screen = () => setup.captureCharFrame()
const waitFor = async (what: string, predicate: () => boolean) => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && !predicate()) await settle(100)
  assert(predicate(), `${what}:\n${screen()}`)
}
try {
  await settle(2500)
  if (screen().includes('New workspace')) { await act(async () => { setup.mockInput.pressEnter() }); await settle(500) }
  await act(async () => { setup.mockInput.pressKey('k', { ctrl: true }) })
  await settle(50)
  await act(async () => { setup.mockInput.pressKey('x') })
  await waitFor('⌃K x opens the mod view', () => screen().includes('Fruit tally') && screen().includes('count 0'))
  console.log('⌃K x opens Mod views and draws the view the mod returned.')

  // Keyboard: the first row is selected; Enter runs its action, which re-renders the view.
  await act(async () => { setup.mockInput.pressEnter() })
  await waitFor('Enter runs the selected row', () => /apples\s+count 1/.test(screen()) && screen().includes('bumped apples'))
  // Mouse: a click on the pears row runs its action.
  const pears = setup.renderer.root.findDescendantById('mod-view-item:pears') as unknown as { x: number; y: number }
  await act(async () => { await setup.mockMouse.click(pears.x + 3, pears.y) })
  await waitFor('a click runs a row', () => /pears\s+count 1/.test(screen()))
  const reset = setup.renderer.root.findDescendantById('mod-view-action:reset') as unknown as { x: number; y: number }
  await act(async () => { await setup.mockMouse.click(reset.x + 3, reset.y) })
  await waitFor('a button runs its action', () => /apples\s+count 0/.test(screen()) && /pears\s+count 0/.test(screen()))
  console.log('Actions: Enter and clicks run the mod\'s actions; the view re-renders and shows the notice.')
  // The mod's own component: its state, its keys, and a call to its server action.
  await act(async () => { setup.mockInput.pressArrow('right') })
  await waitFor('the component view draws', () => screen().includes('GAUGE ### level 3'))
  await act(async () => { await setup.mockInput.typeText('+') })
  await waitFor('the component handles its own key', () => screen().includes('GAUGE #### level 4'))
  await act(async () => { await setup.mockInput.typeText('b') })
  await waitFor('the component runs a server action', () => screen().includes('bumped apples'))
  await settle(500)
  assert(screen().includes('GAUGE #### level 4'), 'running a server action remounted the component and lost its state')
  console.log('Components: a mod\'s own component renders with the app\'s React, keeps state, handles keys and calls its server actions.')
  await act(async () => { setup.mockInput.pressEscape() })
  await waitFor('Esc closes it', () => !screen().includes('GAUGE') && !screen().includes('Fruit tally'))
  console.log('Mod views smoke passed')
} finally {
  act(() => setup.renderer.destroy())
}
process.exit(0)
