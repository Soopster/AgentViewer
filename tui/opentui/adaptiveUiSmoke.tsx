/** @jsxImportSource @opentui/react */
// The Adaptive UI gallery in the terminal: a draft is reviewed with a preview of what it will draw,
// enabled by key, a generic tool hands its design request to the composer, and delete takes two presses.
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'adaptive-tui-'))
process.env.AGENT_VIEWER_UI_RECIPES_DIR = join(root, 'recipes')
process.env.AGENT_VIEWER_ADAPTIVE_UI_DIR = join(root, 'state')
const { testRender, act } = await import('./testRender')
const { DARK_THEME } = await import('../theme')
const { module } = await import('../../plugins/adaptive-ui/tui')
const { nativeAdaptiveUi, recordShape } = await import('../../lib/adaptiveUi/runtime')
const { writeCardRule } = await import('../../lib/adaptiveUi/store')
import type { TuiPluginViewProps, TuiPluginKeyHandler } from './shell/pluginTypes'

const issue = JSON.stringify({ title: 'Fix login', state: 'Done' })
writeCardRule({ id: 'linear.get_issue', status: 'draft', match: { tool: 'mcp__linear__get_issue' }, title: '{{input.id}} · {{result.json.title}}', blocks: [{ type: 'badge', text: '{{result.json.state}}' }], samples: [{ input: { id: 'ENG-1' }, result: { text: issue } }] })
recordShape({ tool: 'mcp__notion__search', mcpServer: 'notion', inputKeys: ['query'], sample: { input: { query: 'roadmap' }, result: { text: '[]', isError: false } } })

let handler: TuiPluginKeyHandler | null = null
const inserted: string[] = []
const View = module.views['adaptive-ui']!
function Harness() {
  const props: TuiPluginViewProps = { pluginId: 'adaptive-ui', surfaceId: 'adaptive-ui', instanceId: 'adaptive-smoke', placement: 'panel', target: { cwd: root, sessionKey: null }, services: { 'adaptive-ui': nativeAdaptiveUi, composer: { insertPrompt: (text: string) => { inserted.push(text) }, appendDiffNote: () => {} } }, theme: DARK_THEME, accent: DARK_THEME.cyan, syntaxStyle: null, width: 120, height: 30, focused: true, zIndex: 50, useState: ((_name: string, initial: unknown) => React.useState(initial)) as never, onDispose: () => () => {}, registerKeys: (value: TuiPluginKeyHandler | null) => { handler = value }, setCapture: () => {}, runCommand: () => false, close: () => {} } as never
  return <View {...props} />
}
const setup = await testRender(<Harness />, { width: 120, height: 30 })
const frame = () => setup.captureCharFrame()
async function waitFor(label: string, test: () => boolean) { for (let i = 0; i < 100; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); await setup.flush() }); if (test()) return } assert.fail(`${label}\n${frame()}`) }
async function key(name: string) { await act(async () => { handler?.({ name, sequence: name, ctrl: false, shift: false }); await new Promise(resolve => setTimeout(resolve, 60)); await setup.flush() }) }
const status = () => (JSON.parse(readFileSync(join(root, 'recipes', 'linear.get_issue.json'), 'utf8')) as { status: string }).status
try {
  await waitFor('draft and generic tool listed', () => frame().includes('linear.get_issue') && frame().includes('mcp__notion__search'))
  assert(frame().includes('◐'), 'a draft is marked as one')
  assert(frame().includes('ENG-1 · Fix login') && frame().includes('[Done]'), `the draft is previewed against its sample\n${frame()}`)
  await key('a'); await waitFor('enabled', () => status() === 'active' && frame().includes('●'))
  await key('j'); await key('g')
  await waitFor('design request handed to the composer', () => inserted.length === 1)
  assert(inserted[0]!.includes('notion.search.json') && inserted[0]!.includes('"status": "draft"') && inserted[0]!.includes('roadmap'))
  await key('k'); await key('x'); await waitFor('first press only arms', () => frame().includes('Press delete again'))
  assert(existsSync(join(root, 'recipes', 'linear.get_issue.json')), 'one press does not delete')
  await key('x'); await waitFor('second press deletes', () => !existsSync(join(root, 'recipes', 'linear.get_issue.json')))
  // Any other key disarms: a stray x later does not delete.
  console.log('adaptiveUiSmoke(tui): ok')
} finally { setup.renderer.destroy() }
process.exit(0)
