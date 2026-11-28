/** @jsxImportSource @opentui/react */
// The pstack panel: edits a role, shows a rejected one, and installs the playbooks without overwriting.
import assert from 'node:assert/strict'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { module } from '../../plugins/pstack/tui'

const saved: Array<[string, string]> = []
const written: string[] = []
const state = (roles: Record<string, string>) => ({ configFile: '/c/pstack.json', version: '1.2.3', skills: ['arena', 'poteto-mode', 'principle-x'], roles, problems: [{ role: 'bug-fix', message: 'Model nope is not advertised' }] })
let roles: Record<string, string> = { 'bug-fix': 'codex nope' }
const services = {
  repository: { cwd: '/p', sessionId: null },
  pstack: {
    read: async () => state(roles),
    saveRole: async (_cwd: string, role: string, line: string) => { saved.push([role, line]); roles = { ...roles, [role]: line }; return state(roles) },
  },
  playbooks: { list: async () => ({ playbooks: [{ name: 'pstack-arena' }], invalid: [] }), read: async () => { throw new Error('customized') }, write: async (_c: string, p: { name: string }) => { written.push(p.name); return {} }, remove: async () => {} },
}
let keys: (key: any) => boolean | void = () => false
const View = module.views.pstack as any
const size = { width: 110, height: 34 }
const t = await testRender(<View services={services} theme={DARK_THEME} width={size.width} height={size.height} placement="window" zIndex={1} registerKeys={(h: any) => { if (h) keys = h }} close={() => {}} />, size)
const settle = async (ms = 80) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); await t.flush?.() }); await t.renderOnce() }
const press = async (name: string, sequence = name) => { await act(async () => { keys({ name, sequence, ctrl: false, shift: false, meta: false }); await new Promise(r => setTimeout(r, 30)) }) }

await settle()
let screen = t.captureCharFrame()
assert(screen.includes('pstack 1.2.3 · 3 skills') && screen.includes('feature, refactoring') && screen.includes('session model'), screen)
assert(screen.includes('✗ bug-fix'), 'a rejected role is marked')
await press('return')
for (const char of 'codex high') await press(char === ' ' ? 'space' : char, char)
await press('return')
await settle()
assert.deepEqual(saved, [['feature, refactoring', 'codex high']], 'typing edits the role, j and k included')
assert(t.captureCharFrame().includes('codex high'))
await press('i', 'i')
await settle(150)
assert.deepEqual(written, ['pstack-interrogate'], 'only the missing playbook is written')
t.renderer.destroy()
console.log('pstackViewSmoke ok')
process.exit(0)
