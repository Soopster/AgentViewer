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
const refined: [string, string][] = []
const service = { ...nativeAdaptiveUi, refineHere: async (id: string, instruction: string) => { refined.push([id, instruction]); return `${id} changed` } }
let resize: ((size: { width: number; height: number }) => void) | undefined
const View = module.views['adaptive-ui']!
function Harness() {
  const [size, setSize] = React.useState({ width: 120, height: 30 }); resize = setSize
  const props: TuiPluginViewProps = { pluginId: 'adaptive-ui', surfaceId: 'adaptive-ui', instanceId: 'adaptive-smoke', placement: 'panel', target: { cwd: root, sessionKey: null }, services: { 'adaptive-ui': service, composer: { insertPrompt: (text: string) => { inserted.push(text) }, appendDiffNote: () => {} } }, theme: DARK_THEME, accent: DARK_THEME.cyan, syntaxStyle: null, ...size, focused: true, zIndex: 50, useState: ((_name: string, initial: unknown) => React.useState(initial)) as never, onDispose: () => () => {}, registerKeys: (value: TuiPluginKeyHandler | null) => { handler = value }, setCapture: () => {}, runCommand: () => false, close: () => {} } as never
  return <View {...props} />
}
const setup = await testRender(<Harness />, { width: 120, height: 30 })
const frame = () => setup.captureCharFrame()
async function waitFor(label: string, test: () => boolean) { for (let i = 0; i < 100; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); await setup.flush() }); if (test()) return } assert.fail(`${label}\n${frame()}`) }
async function key(name: string) { await act(async () => { handler?.({ name, sequence: name, ctrl: false, shift: false }); await new Promise(resolve => setTimeout(resolve, 60)); await setup.flush() }) }
const status = () => (JSON.parse(readFileSync(join(root, 'recipes', 'linear.get_issue.json'), 'utf8')) as { status: string }).status
try {
  await waitFor('draft and generic tool listed', () => frame().includes('linear.get_issue') && frame().includes('mcp__notion__search'))
  if (process.env.DUMP) console.log(frame())
  // The workspace hierarchy: filters with counts over a list, the selected card's detail with its tabs and actions.
  for (const chip of ['All 2', 'Suggested 0', 'Cards 1', 'Generic 1', 'Refused 0']) assert(frame().includes(chip), `filter chip ${chip}\n${frame()}`)
  for (const label of ['CARDS', 'DRAWN GENERICALLY', 'Preview', 'Why', 'History', 'Rule', '[a] Enable', '[f] Change with an agent', '[x] Delete']) assert(frame().includes(label), `${label} is on screen\n${frame()}`)
  assert(!frame().includes(root), 'the header does not carry an absolute path')
  assert(frame().includes('draft: review it') && frame().includes('no card · 1 call'), 'each row says what state it is in, in words')
  assert(frame().includes('◐'), 'a draft is marked as one')
  assert(frame().includes('ENG-1 · Fix login') && frame().includes('[Done]'), `the draft is previewed against its sample\n${frame()}`)
  // Tabs are real views of the selected card; the selection stays when they change.
  await key('right'); await waitFor('Why tab', () => frame().includes('Derived from the rule') && frame().includes('cannot'))
  await key('right'); await waitFor('History tab', () => frame().includes('create'))
  await key('right'); await waitFor('Rule tab', () => frame().includes('"status": "draft"'))
  await key('left'); await key('left'); await key('left'); await waitFor('back on Preview', () => frame().includes('ENG-1 · Fix login'))
  // Help captures input: j scrolls the help and must not move the selection.
  await key('?'); await waitFor('help opens', () => frame().includes('Adaptive UI shortcuts'))
  await key('j'); await key('escape'); await waitFor('help closed by Escape first', () => !frame().includes('Adaptive UI shortcuts') && frame().includes('Preview'))
  // Typing a change: the textarea owns the keyboard, Escape cancels, Enter hands the words to the model.
  await key('c'); await waitFor('change input opens', () => frame().includes('Change this card: say what you want'))
  await key('escape'); await waitFor('Escape cancels typing, not the gallery', () => !frame().includes('Change this card: say what you want') && frame().includes('Preview'))
  assert.equal(refined.length, 0, 'cancelling applies nothing')
  await key('c'); await waitFor('change input opens again', () => frame().includes('Change this card: say what you want'))
  await act(async () => { setup.mockInput.typeText('show the owner'); await new Promise(resolve => setTimeout(resolve, 80)); await setup.flush() })
  await key('return'); await waitFor('instruction sent', () => refined.length === 1)
  assert.deepEqual(refined[0], ['linear.get_issue', 'show the owner'], 'the typed words reach the service for this card')
  await waitFor('input closed', () => !frame().includes('Change this card: say what you want'))
  await key('1') // back to the list: j/k scroll the detail while it has focus
  // Filters narrow the collection.
  await key(']'); await key(']'); await waitFor('Cards filter', () => !frame().includes('mcp__notion__search') && frame().includes('linear.get_issue'))
  await key(']'); await waitFor('Generic filter', () => frame().includes('mcp__notion__search') && !frame().includes('[a] Enable'))
  assert(!frame().includes('Nothing under'), 'a filter with items does not claim to be empty')
  if (process.env.DUMP) console.log(frame())
  // A sample is laid out, not dumped: input as aligned rows, the result behind a gutter, nothing repeated from the header.
  for (const text of ['Sample', 'Input', 'query', 'roadmap', 'Result', '│ ']) assert(frame().includes(text), `${text} in the sample view\n${frame()}`)
  assert(!frame().includes('{"query":"roadmap"}'), 'the input is not shown as compact JSON')
  assert(frame().split('\n').filter(row => row.includes('1 call')).length === 1, 'the call count is said once')
  await key(']'); await waitFor('Refused filter is empty', () => frame().includes('Nothing under Refused'))
  await key('['); await key('['); await key('['); await key('['); await waitFor('All again', () => frame().includes('CARDS') && frame().includes('DRAWN GENERICALLY'))
  await key('a'); await waitFor('enabled', () => status() === 'active' && frame().includes('●'))
  await key('j'); await key('g')
  await waitFor('design request handed to the composer', () => inserted.length === 1)
  assert(inserted[0]!.includes('notion.search.json') && inserted[0]!.includes('"status": "draft"') && inserted[0]!.includes('roadmap'))
  await key('k'); await key('x'); await waitFor('first press only arms', () => frame().includes('Press delete again'))
  assert(existsSync(join(root, 'recipes', 'linear.get_issue.json')), 'one press does not delete')
  await key('x'); await waitFor('second press deletes', () => !existsSync(join(root, 'recipes', 'linear.get_issue.json')))
  // Any other key disarms: a stray x later does not delete.
  // A narrow panel shows the list or the detail, with a way back; Escape goes back before it would close.
  await act(async () => resize?.({ width: 70, height: 24 })); await act(async () => { await setup.flush() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); await setup.flush() })
  await key('escape')
  assert(!frame().includes('[h] Design here') || frame().includes('[‹ list]'), 'narrow starts on one pane')
  await waitFor('narrow shows the list only', () => frame().includes('mcp__notion__search') && !frame().includes('[h] Design here'))
  await key('return'); await waitFor('narrow opens the detail', () => frame().includes('[h] Design here') && frame().includes('[‹ list]'))
  await key('escape'); await waitFor('Escape returns to the list', () => !frame().includes('[h] Design here') && frame().includes('mcp__notion__search'))
  console.log('adaptiveUiSmoke(tui): ok')
} finally { setup.renderer.destroy() }
process.exit(0)
