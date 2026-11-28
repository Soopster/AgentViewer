/** @jsxImportSource @opentui/react */
// The panel: setup state, ⏎ and `s` fill the composer, `i` installs the playbook.
import assert from 'node:assert/strict'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { module } from '../../plugins/matt-skills/tui'

const inserted: string[] = []
const written: string[] = []
let closed = 0
const skill = (name: string, userInvoked: boolean) => ({ name, userInvoked, description: `About ${name}.` })
const services = {
  repository: { cwd: '/p', sessionId: null },
  'matt-skills': { read: async () => ({ version: '1.3.2', skills: [skill('grill-me', true), skill('tdd', false), skill('wayfinder', true)], setup: { root: '/p', configured: false, files: [{ path: 'docs/agents/issue-tracker.md', exists: false }, { path: 'GLOSSARY.md', exists: true }] } }) },
  composer: { insertText: (text: string) => { inserted.push(text) }, appendDiffNote: () => {} },
  playbooks: { list: async () => ({ playbooks: [], invalid: [] }), read: async () => { throw new Error('missing') }, write: async (_c: string, p: { name: string }) => { written.push(p.name); return {} }, remove: async () => {} },
}
let keys: (key: any) => boolean | void = () => false
const View = module.views['matt-skills'] as any
const size = { width: 110, height: 34 }
const t = await testRender(<View services={services} theme={DARK_THEME} width={size.width} height={size.height} placement="window" zIndex={1} registerKeys={(h: any) => { if (h) keys = h }} close={() => { closed++ }} />, size)
const settle = async (ms = 80) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); await t.flush?.() }); await t.renderOnce() }
const press = async (name: string, sequence = name) => { await act(async () => { keys({ name, sequence, ctrl: false, shift: false, meta: false }); await new Promise(r => setTimeout(r, 30)) }) }

await settle()
let screen = t.captureCharFrame()
assert(screen.includes('1.3.2 · 3') && screen.includes('Not set up') && screen.includes('✓ GLOSSARY.md') && screen.includes('About grill-me.'), screen)
await press('j', 'j')
await press('return')
await press('s', 's')
// Grouped order: the two a person starts, then the one the agent reaches for.
assert.deepEqual(inserted, ['/matt /wayfinder ', '/matt /setup-matt-pocock-skills '])
assert.equal(closed, 0, 'a docked panel stays open')
await press('i', 'i')
await settle(150)
assert.deepEqual(written, ['matt-code-review'])
t.renderer.destroy()
console.log('mattSkillsViewSmoke ok')
process.exit(0)
