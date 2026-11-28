/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { module as memory } from '../../plugins/project-memory/tui'
import { module as packs } from '../../plugins/workflow-packs/tui'
import { createProjectMemory } from '../../lib/project-memory/service'
import { WORKFLOW_PACKS } from '../../lib/plugins/workflowPacks'
import { blankMemory } from '../../lib/plugins/projectMemory'
import { listRunPlaybooks, loadRunPlaybook, writeRunPlaybook, deleteRunPlaybook } from '../../lib/agentCoordination'
import type { PluginPlaybookService } from '../../lib/plugins/playbooks'
import type { TuiPluginViewProps, TuiPluginKeyHandler } from './shell/pluginTypes'
const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'knowledge-tui-'))), cwd = path.join(temp, 'repo'); await mkdir(cwd)
const service = createProjectMemory(() => path.join(temp, 'memory')), note = { ...blankMemory(), title: 'TUI memory note', body: 'Keep scoped service identities stable.' }
await service.mutate(cwd, crypto.randomUUID(), { type: 'save', note })
const playbooks: PluginPlaybookService = { list: listRunPlaybooks, read: loadRunPlaybook, write: writeRunPlaybook, remove: async (root, name) => { await deleteRunPlaybook(root, name) } }
let resizeView: ((value: { width: number; height: number }) => void) | undefined
let openedSource: { sessionId: string; providerInstanceId?: string } | undefined
let handler: TuiPluginKeyHandler | null = null, update: ((value: { focused: boolean; packs: boolean }) => void) | undefined
function Harness() {
  const [size, setSize] = React.useState({ width: 140, height: 40 }); resizeView = setSize
  const [state, setState] = React.useState({ focused: true, packs: false }); update = setState
  const View = state.packs ? packs.views['workflow-packs']! : memory.views['project-memory']!, id = state.packs ? 'workflow-packs' : 'project-memory'
  const props: TuiPluginViewProps = { pluginId: id, surfaceId: id, instanceId: 'knowledge', placement: 'panel', target: { cwd, sessionKey: null }, services: { 'project-memory': service, playbooks, repository: { cwd, sessionId: null }, session: { session: { provider: 'codex', providerInstanceId: 'work', sessionId: 'capture-source', cwd } as never }, 'session-transcript': { status: 'ready', detail: { rawMessages: [{ type: 'assistant', uuid: 'reply-1', session_id: 'capture-source', parent_tool_use_id: null, message: { role: 'assistant', content: 'A captured project lesson.' } }] } as never }, 'session-navigation': { open: (source: typeof openedSource) => { openedSource = source } } as never }, theme: DARK_THEME, accent: DARK_THEME.cyan, syntaxStyle: null, ...size, focused: state.focused, zIndex: 50, useState: ((_name: string, initial: unknown) => React.useState(initial)) as never, onDispose: () => () => {}, registerKeys: value => { handler = value }, setCapture: () => {}, runCommand: () => false, close: () => {} }
  return <View {...props} />
}
const setup = await testRender(<Harness />, { width: 140, height: 40 })
async function waitFor(label: string, test: () => boolean | Promise<boolean>) { for (let i = 0; i < 100; i++) { let ok = false; await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); await setup.flush(); ok = await test() }); if (ok) return } throw new Error(`${label}\n${setup.captureCharFrame()}`) }
async function key(name: string, ctrl = false) { await act(async () => { handler?.({ name, sequence: name, ctrl, shift: false }); await new Promise(resolve => setTimeout(resolve, 40)); await setup.flush() }) }
async function click(label: string) {
  const rows = setup.captureCharFrame().split('\n'), y = rows.findIndex(row => row.includes(label))
  assert(y >= 0, `Missing ${label}\n${rows.join('\n')}`)
  await act(async () => { await setup.mockMouse.click(rows[y].indexOf(label) + 1, y); await setup.flush() })
}
try {
  await waitFor('memory list', () => setup.captureCharFrame().includes('TUI memory note'))
  await key('j'); await key('y'); await key('s')
  await waitFor('note type saved', async () => (await service.read(cwd)).notes[0].kind === 'decision')
  await key('a'); await waitFor('approved', async () => (await service.read(cwd)).notes[0].reviewed)
  await click('Drafts (0)'); await waitFor('empty filter', () => setup.captureCharFrame().includes('No notes match'))
  await click('Approved (1)'); await waitFor('approved filter', () => setup.captureCharFrame().includes('Keep scoped service identities stable.'))
  await key('?'); await waitFor('memory help', () => setup.captureCharFrame().includes('Memory shortcuts'))
  await key('d'); await key('escape'); assert.equal((await service.read(cwd)).notes.length, 1, 'help consumes background deletion')
  await key('r'); await waitFor('recall enabled', async () => (await service.read(cwd)).autoRecall)
  await act(async () => update?.({ focused: false, packs: false })); assert.equal((handler as TuiPluginKeyHandler | null)?.({ name: 'd', sequence: 'd', ctrl: false, shift: false }), false)
  await act(async () => update?.({ focused: true, packs: true })); await waitFor('packs', () => setup.captureCharFrame().includes('Deliberate Development'))
  await key('p'); await waitFor('preview', () => setup.captureCharFrame().includes('1 missing'))
  await key('i'); await waitFor('installed', async () => (await listRunPlaybooks(cwd)).playbooks.length === 1)
  await waitFor('installed workflow state', () => setup.captureCharFrame().includes('pack-deliberate-development · installed'))
  await click('Stages'); await waitFor('stage list', () => setup.captureCharFrame().includes('Research and plan'))
  await key('j'); await waitFor('stage detail', () => setup.captureCharFrame().includes('Implement the approved scope'))
  await key('f'); await waitFor('full definition', () => setup.captureCharFrame().includes('"playbooks"'))
  await key('f')
  await click('Systematic Debugging'); await key('i')
  assert.equal((await listRunPlaybooks(cwd)).playbooks.length, 1, 'changing pack invalidates the previous install preview')
  await key('e'); await act(async () => { await setup.mockInput.typeText(JSON.stringify(WORKFLOW_PACKS[2])); await setup.flush() }); await key('s', true)
  await waitFor('import JSON inspected', () => setup.captureCharFrame().includes('Test-driven Development'))
  await act(async () => { setup.resize(64, 22); resizeView?.({ width: 64, height: 22 }) })
  await key('1'); await waitFor('narrow pack list', () => setup.captureCharFrame().includes('[1] Packs'))
  await key('return'); await waitFor('narrow pack detail', () => !setup.captureCharFrame().includes('[1] Packs') && setup.captureCharFrame().includes('Overview'))
  await key('?'); await waitFor('bounded narrow help', () => setup.captureCharFrame().includes('Workflow pack shortcuts'))
  await key('pagedown'); await key('escape')
  await act(async () => { setup.resize(140, 40); resizeView?.({ width: 140, height: 40 }); update?.({ focused: true, packs: false }) })
  await waitFor('memory reopens', () => setup.captureCharFrame().includes('TUI memory note'))
  await key('d'); await waitFor('empty memory actions', () => setup.captureCharFrame().includes('Build shared project memory'))
  await click('[c] Capture latest reply'); await waitFor('capture editor', () => setup.captureCharFrame().includes('Edit title'))
  await key('s', true); await waitFor('captured note saved', async () => (await service.read(cwd)).notes.some(note => note.source?.sessionId === 'capture-source'))
  await click('Source'); await click('[o] Open conversation')
  assert.equal(openedSource?.sessionId, 'capture-source'); assert.equal(openedSource?.providerInstanceId, 'work')
  await key('n'); await act(async () => { await setup.mockInput.typeText('Manual convention'); await setup.flush() })
  await key('return'); await act(async () => { await setup.mockInput.typeText('Keep fixture state isolated.'); await setup.flush() }); await key('s', true)
  await waitFor('new note saved', async () => (await service.read(cwd)).notes.some(note => note.title === 'Manual convention' && note.body === 'Keep fixture state isolated.' && !note.reviewed))
  await act(async () => { setup.resize(64, 22); resizeView?.({ width: 64, height: 22 }) })
  await key('2'); await waitFor('narrow memory list', () => setup.captureCharFrame().includes('[2] Notes'))
  await key('return'); await waitFor('narrow note reader', () => setup.captureCharFrame().includes('Keep fixture state isolated.'))
  await key('1'); await waitFor('narrow filters', () => setup.captureCharFrame().includes('[1] Memory'))
  await key('return'); await waitFor('narrow filters close', () => !setup.captureCharFrame().includes('[1] Memory'))
  console.log('Knowledge plugins OpenTUI: PASS (memory selection/review/recall, focus gating, pack preview/install, stage navigation, import JSON, note filters/creation/capture/source, modal help, responsive panes)')
} finally { await act(async () => setup.renderer.destroy()); await rm(temp, { recursive: true, force: true }) }
process.exit(0)
