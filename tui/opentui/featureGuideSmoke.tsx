/** @jsxImportSource @opentui/react */
// What's new in Agent Viewer: the guide's entries point at things that exist
// (plugins, palette commands), and the TUI view lists, searches, filters, copies
// and runs a feature's command.
import React from 'react'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { FeatureGuidePopover } from '../../plugins/feature-guide/tui/FeatureGuidePopover'
import { FEATURE_AREAS, FEATURE_GUIDE, featureGuideRows, featureNewAfter, filterFeatures, sortedFeatures, type FeatureGuideEntry } from '../../lib/featureGuide'
import { PLUGIN_MANIFESTS } from '../../lib/plugins/catalog'
import { COMMANDS } from './app/commands'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// ── The catalog only names things that exist ────────────────────────────────
{
  const pluginIds = new Set<string>(PLUGIN_MANIFESTS.map((manifest) => manifest.id))
  const commandIds = new Set<string>(COMMANDS.map((command) => command.id))
  const ids = new Set<string>()
  for (const entry of FEATURE_GUIDE) {
    assert(!ids.has(entry.id), `duplicate feature id ${entry.id}`)
    ids.add(entry.id)
    assert(/^\d{4}-\d{2}-\d{2}$/.test(entry.added) && !Number.isNaN(Date.parse(entry.added)), `${entry.id}: added is an ISO date`)
    assert(FEATURE_AREAS.includes(entry.area), `${entry.id}: known area`)
    assert(entry.summary.length > 20 && entry.tui.length + entry.web.length > 0, `${entry.id}: says what it is and how to use it`)
    if (entry.plugin) assert(pluginIds.has(entry.plugin), `${entry.id}: plugin ${entry.plugin} is bundled`)
    if (entry.command) assert(commandIds.has(entry.command), `${entry.id}: TUI palette has command ${entry.command}`)
  }
}

// ── Model: newest first, search, area filter, date headings, new marks ──────
const sample: FeatureGuideEntry[] = [
  { id: 'old', title: 'Old thing', added: '2026-11-01', area: 'Review', summary: 'An older feature worth a sentence.', tui: ['press x'], web: [] },
  { id: 'a', title: 'Alpha feature', added: '2026-11-20', area: 'Agents', summary: 'Alpha does a useful thing for agents.', tui: ['press a'], web: ['click a'], command: 'alpha', plugin: 'alpha-plugin' },
  { id: 'b', title: 'Beta feature', added: '2026-11-20', area: 'Composer', summary: 'Beta helps you write prompts quicker.', tui: [], web: ['click b'], notes: ['a hidden ZEBRA note'] },
]
{
  const sorted = sortedFeatures(sample)
  assert(sorted.map((entry) => entry.id).join() === 'a,b,old', 'newest first, written order within a day')
  assert(filterFeatures(sorted, 'zebra').map((entry) => entry.id).join() === 'b', 'search reads notes')
  assert(filterFeatures(sorted, 'alpha agents').length === 1, 'every query word must match')
  assert(filterFeatures(sorted, '', 'Review').map((entry) => entry.id).join() === 'old', 'area filter')
  const newAfter = featureNewAfter(sorted)
  assert(newAfter === '2026-11-13', 'new means the week ending at the newest entry')
  const rows = featureGuideRows(sorted, newAfter)
  assert(rows.map((row) => row.type).join() === 'date,feature,feature,date,feature', 'a heading per day')
  assert(rows.filter((row) => row.type === 'feature' && row.isNew).length === 2, 'only the last week is new')
}

// ── The TUI view ─────────────────────────────────────────────────────────────
let closed = 0
const closedCount = (): number => closed
let copied = ''
let ran: string[] = []
const notices: string[] = []
async function mount(size: { width: number; height: number }, runResult = true) {
  let keys: (key: any) => boolean | void = () => false
  const t = await testRender(
    <FeatureGuidePopover theme={DARK_THEME as any} accentColor="#7aa2f7" width={size.width} height={size.height} docked entries={sample}
      onClose={() => { closed++ }} onNotice={(_tone, text) => { notices.push(text) }} onKeyHandlerReady={(handler) => { keys = handler }}
      onCopy={(text) => { copied = text }} onRunCommand={(id) => { ran.push(id); return runResult }} />,
    size,
  )
  const press = async (name: string, sequence = name.length === 1 ? name : '') => { await act(async () => { keys({ name, sequence, ctrl: false, shift: false }); await new Promise((r) => setTimeout(r, 20)) }) }
  const type = async (text: string) => { for (const ch of text) await press(ch, ch) }
  const frame = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 40)) }); await t.renderOnce(); return t.captureCharFrame() }
  return { t, press, type, frame }
}

{
  const { t, press, type, frame } = await mount({ width: 120, height: 30 })
  let screen = await frame()
  assert(screen.includes('3 features · 2 new this week'), 'the header counts features and new ones')
  assert(screen.includes('Fri, Nov 20, 2026') && screen.includes('Sun, Nov 1, 2026'), 'date headings')
  assert(screen.includes('✦ Alpha feature') && screen.includes('· Old thing'), 'new features carry a mark')
  assert(screen.includes('HOW TO USE IT HERE') && screen.includes('press a') && screen.includes('click a'), 'the first feature shows both how-tos')
  assert(screen.includes('Try it'), 'a feature with a command offers it')

  await press('j')
  screen = await frame()
  assert(screen.includes('on the Web app only') && screen.includes('ZEBRA'), 'a Web-only feature says so, with its notes')

  await press('c')
  assert(copied.startsWith('## Beta feature') && copied.includes('**Web**'), 'c copies the feature as markdown')

  await press('k')
  await press('o')
  assert(ran.join() === 'alpha' && closedCount() === 1, 'o runs the feature command and closes the guide')

  await press('/')
  await type('old')
  screen = await frame()
  assert(screen.includes('/old') && screen.includes('1 of 3 features'), 'search narrows as you type')
  assert(screen.includes('Old thing') && !screen.includes('Alpha feature'), 'only matches are listed')
  await press('o')
  assert(ran.length === 1, 'keys typed into search do not run commands')
  await press('return')
  await press('escape')
  screen = await frame()
  assert(screen.includes('Alpha feature') && closedCount() === 1, 'Escape clears a search before closing')

  await press('f')
  screen = await frame()
  assert(screen.includes('showing Agents') && !screen.includes('Beta feature'), 'f narrows to one area')
  await press('escape')
  await press('?')
  screen = await frame()
  assert(screen.includes('Search titles, steps and notes'), 'help lists the keys')
  await press('escape')
  await press('escape')
  assert(closedCount() === 2, 'Escape closes help, then the guide')
  t.renderer.destroy?.()
}

{
  ran = []
  const { t, press, frame } = await mount({ width: 60, height: 26 }, false)
  let screen = await frame()
  assert(screen.includes('Alpha feature') && !screen.includes('HOW TO USE IT HERE'), 'narrow shows the list alone')
  await press('return')
  screen = await frame()
  assert(screen.includes('← all features') && screen.includes('press a'), 'Enter opens the detail with a way back')
  await press('o')
  assert(ran.join() === 'alpha' && notices.some((text) => text.includes('alpha-plugin')), 'a command nothing claims says which plugin to turn on')
  await press('escape')
  screen = await frame()
  assert(!screen.includes('← all features'), 'Escape goes back to the list')
  t.renderer.destroy?.()
}

console.log('featureGuideSmoke: PASS')
process.exit(0)
