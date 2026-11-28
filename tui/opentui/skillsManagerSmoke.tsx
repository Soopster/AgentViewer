/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { module } from '../../plugins/skills-manager/tui'
import type { SkillsContext } from '../../lib/skills-manager/roots'
import { createSkillsManager } from '../../lib/skills-manager/service'
import type { TuiPluginViewProps, TuiPluginKeyHandler } from './shell/pluginTypes'
const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'skills-tui-'))), cwd = path.join(temp, 'repo'), home = path.join(temp, 'home'), source = path.join(home, '.claude', 'skills', 'tui-demo'), work = path.join(home, 'work')
await mkdir(cwd); await mkdir(source, { recursive: true }); await writeFile(path.join(source, 'SKILL.md'), '---\nname: tui-demo\ndescription: Terminal fixture\n---\n# TUI skill')
await mkdir(path.join(source, 'references')); await writeFile(path.join(source, 'references', 'example.md'), '# Supporting resource\nRead this **important** example with `code`.\n\n| Item | Value |\n| --- | --- |\n| Example | Ready |')
const service = createSkillsManager(async (): Promise<SkillsContext> => ({ home, environment: { HOME: home }, dataDir: path.join(temp, 'state'), instances: [{ id: 'claude', provider: 'claude', displayName: 'Claude', environment: {} }, { id: 'work', provider: 'claude', displayName: 'Claude Work', environment: { CLAUDE_CONFIG_DIR: work } }] }))
const snapshot = await service.scan(cwd), selected = snapshot.skills[0], roots = snapshot.roots.filter(root => root.id !== selected.rootId), workIndex = roots.findIndex(root => root.path === path.join(work, 'skills'))
let setSize: ((value: { width: number; height: number }) => void) | undefined
let handler: TuiPluginKeyHandler | null = null, setFocused: ((value: boolean) => void) | undefined
const View = module.views['skills-manager']!
function Harness() {
  const [size, resize] = React.useState({ width: 140, height: 40 }); setSize = resize
  const [focused, update] = React.useState(true); setFocused = update
  const props: TuiPluginViewProps = { pluginId: 'skills-manager', surfaceId: 'skills-manager', instanceId: 'skills-smoke', placement: 'panel', target: { cwd, sessionKey: null }, services: { 'skills-manager': service, repository: { cwd, sessionId: null } }, theme: DARK_THEME, accent: DARK_THEME.cyan, syntaxStyle: null, ...size, focused, zIndex: 50, useState: ((_name: string, initial: unknown) => React.useState(initial)) as never, onDispose: () => () => {}, registerKeys: value => { handler = value }, setCapture: () => {}, runCommand: () => false, close: () => {} }
  return <View {...props} />
}
const setup = await testRender(<Harness />, { width: 140, height: 40 })
async function waitFor(label: string, test: () => boolean | Promise<boolean>) { for (let i = 0; i < 100; i++) { let ok = false; await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); await setup.flush(); ok = await test() }); if (ok) return } throw new Error(`${label}\n${setup.captureCharFrame()}`) }
async function key(name: string, ctrl = false) { await act(async () => { handler?.({ name, sequence: name, ctrl, shift: false }); await new Promise(resolve => setTimeout(resolve, 40)); await setup.flush() }) }
async function click(label: string, last = false) {
  const rows = setup.captureCharFrame().split('\n'), y = last ? rows.findLastIndex(row => row.includes(label)) : rows.findIndex(row => row.includes(label))
  assert(y >= 0, `Missing clickable label: ${label}\n${rows.join('\n')}`)
  await act(async () => { await setup.mockMouse.click(rows[y].indexOf(label) + 1, y); await setup.flush() })
}
try {
  await waitFor('inventory', () => setup.captureCharFrame().includes('tui-demo'))
  await waitFor('raw Markdown source', () => setup.captureCharFrame().includes('# TUI skill'))
  await click('Rich'); await waitFor('rich Markdown and frontmatter', () => setup.captureCharFrame().includes('Skill metadata') && setup.captureCharFrame().includes('TUI skill') && !setup.captureCharFrame().includes('# TUI skill'))
  await click('Raw'); await waitFor('raw source restored', () => setup.captureCharFrame().includes('# TUI skill'))
  assert(setup.captureCharFrame().includes('[1] Locations'))
  assert(setup.captureCharFrame().includes('[2] Skills'))
  assert(!setup.captureCharFrame().includes('explicit replacement with backup'), 'shortcut reference stays collapsed')
  await key('?'); await waitFor('help opens', () => setup.captureCharFrame().includes('Skills shortcuts'))
  await key('v'); await key('escape')
  assert(setup.captureCharFrame().includes('# TUI skill'), 'help consumes background raw/rich action')
  await click('Files'); await waitFor('resource tree', () => setup.captureCharFrame().includes('references/example.md'))
  await click('references/example.md'); await waitFor('resource opens', () => setup.captureCharFrame().includes('Supporting resource'))
  await key('v'); await waitFor('rich supporting resource', () => setup.captureCharFrame().includes('Supporting resource') && !setup.captureCharFrame().includes('# Supporting resource') && setup.captureCharFrame().includes('Ready'))
  await key('v'); await waitFor('raw supporting resource', () => setup.captureCharFrame().includes('# Supporting resource'))
  await click('references', true); await waitFor('folder breadcrumb opens files', () => setup.captureCharFrame().includes('Skill files') && setup.captureCharFrame().includes('example.md'))
  await click('example.md'); await waitFor('file reopens from folder', () => setup.captureCharFrame().includes('# Supporting resource'))
  await key('backspace'); await waitFor('back preserves selected file', () => setup.captureCharFrame().includes('› example.md'))
  await click('Files', true); await waitFor('root breadcrumb restores full paths', () => setup.captureCharFrame().includes('references/example.md'))
  await click('Copy'); for (let i = 0; i < workIndex; i++) await key('j'); await key('space'); await key('p')
  await waitFor('copy preview', () => setup.captureCharFrame().includes('Copy preview'))
  await key('a'); await waitFor('copied', () => setup.captureCharFrame().includes('Skills copied'))
  assert((await readFile(path.join(work, 'skills', 'tui-demo', 'SKILL.md'), 'utf8')).includes('# TUI skill'))
  await act(async () => setFocused?.(false)); assert.equal((handler as TuiPluginKeyHandler | null)?.({ name: 'a', sequence: 'a', ctrl: false, shift: false }), false)
  await act(async () => setFocused?.(true)); await key('h'); await waitFor('receipts', () => setup.captureCharFrame().includes('copied ·'))
  await writeFile(path.join(work, 'skills', 'tui-demo', 'SKILL.md'), '# Destination version')
  await key('p'); await waitFor('replacement requires selection', () => setup.captureCharFrame().includes('replacement not selected'))
  await click('[a] Apply copies')
  assert.equal(await readFile(path.join(work, 'skills', 'tui-demo', 'SKILL.md'), 'utf8'), '# Destination version', 'unselected replacements cannot apply')
  await key('space'); await waitFor('replacement selected', () => setup.captureCharFrame().includes('[x] replace with backup'))
  await click('[a] Apply copies'); await waitFor('replacement applied', () => setup.captureCharFrame().includes('Skills copied'))
  assert((await readFile(path.join(work, 'skills', 'tui-demo', 'SKILL.md'), 'utf8')).includes('# TUI skill'))
  await key('h'); await waitFor('backup receipt', () => setup.captureCharFrame().includes('Backup:'))
  await key('n', true); await waitFor('locations collapse', () => !setup.captureCharFrame().includes('[1] Locations'))
  await key('1'); await waitFor('locations restore', () => setup.captureCharFrame().includes('[1] Locations'))
  await act(async () => { setup.resize(64, 22); setSize?.({ width: 64, height: 22 }) })
  await key('2'); await waitFor('narrow skill list', () => setup.captureCharFrame().includes('[2] Skills'))
  assert(!setup.captureCharFrame().includes('[1] Locations'))
  await key('return'); await waitFor('narrow content', () => setup.captureCharFrame().includes('# Supporting resource'))
  await key('1'); await waitFor('location drawer', () => setup.captureCharFrame().includes('[1] Locations'))
  const emptyRoot = snapshot.roots.find(root => root.scope === 'project')!
  await click(emptyRoot.label.replace(/ skills$/, '').replace('GitHub Copilot', 'Copilot')); await waitFor('empty location', () => setup.captureCharFrame().includes('No skills in this location'))
  await act(async () => { setup.resize(140, 40); setSize?.({ width: 140, height: 40 }) })
  await waitFor('empty workspace actions', () => setup.captureCharFrame().includes('Browse installed skills') && setup.captureCharFrame().includes('Choose a location'))
  await key('/'); await waitFor('search entry', () => setup.captureCharFrame().includes('Search skills · Enter done'))
  await key('escape')
  console.log('Skills Manager OpenTUI: PASS (keyboard selection, destination accounts, copy preview, filesystem copy, receipt, focus gating, clickable resources, replacement gating and backup, responsive panes, rich/raw Markdown and metadata, empty location, search, modal help, folder breadcrumbs and back navigation)')
} finally { await act(async () => setup.renderer.destroy()); await rm(temp, { recursive: true, force: true }) }
process.exit(0)
