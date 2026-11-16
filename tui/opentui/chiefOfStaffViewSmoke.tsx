/** @jsxImportSource @opentui/react */
// The Chief of Staff panel: board and rules read from the service, a typed request starts it,
// and `/cos <request>` arrives through the seed.
import assert from 'node:assert/strict'
import { act, testRender } from './testRender'
import { DARK_THEME } from '../theme'
import { module } from '../../plugins/chief-of-staff/tui'
import { seedChiefOfStaffRequest } from '../../plugins/chief-of-staff/seed'

const started: Array<{ cwd: string; provider: string; request?: string }> = []
const opened: string[] = []
let session: { sessionId: string; provider: string } | null = null
let ruleList: Array<Record<string, unknown>> = [{ match: 'frontend', provider: 'claude', model: 'opus' }]
const saved: Array<Array<Record<string, unknown>>> = []
const state = () => ({
  repoRoot: '/p', rulesFile: '/p/.agent-viewer/chief-of-staff.json', session,
  rules: ruleList, ruleList,
  report: session ? { text: 'Two things need you.\nMigrate db is blocked', at: 1_700_000_000_000 } : null,
  problems: [{ rule: 2, message: '"db": Model x is not advertised by codex' }],
  board: session ? { workstreams: [{ title: 'Build form', status: 'in_progress', owner: 'fe', provider: 'codex' }], needsYou: ['Migrate db is blocked'], summary: '1 open' } : null,
})
const services = {
  repository: { cwd: '/p', sessionId: null },
  session: { session: { provider: 'claude', sessionId: 's' } },
  'session-navigation': { open: (ref: { sessionId: string }) => { opened.push(ref.sessionId) } },
  'chief-of-staff': {
    read: async () => state(),
    saveRules: async (_cwd: string, next: Array<Record<string, unknown>>) => { if (next.some(rule => rule.provider === 'nope')) throw new Error('unknown provider'); saved.push(next); ruleList = next; return state() },
    start: async (params: { cwd: string; provider: string; request?: string }) => { started.push(params); session = { sessionId: 'cos-1', provider: 'claude' }; return { sessionId: 'cos-1', provider: 'claude', created: true } },
  },
  notices: { show: () => {} },
}
let keys: (key: any) => boolean | void = () => false
const View = module.views['chief-of-staff'] as any
const size = { width: 110, height: 34 }
const t = await testRender(<View services={services} theme={DARK_THEME} width={size.width} height={size.height} placement="window" zIndex={1} registerKeys={(h: any) => { if (h) keys = h }} close={() => {}} />, size)
const settle = async (ms = 80) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); await t.flush?.() }); await t.renderOnce() }
const press = async (name: string, sequence = name) => { await act(async () => { keys({ name, sequence, ctrl: false, shift: false, meta: false }); await new Promise(r => setTimeout(r, 30)) }) }

await settle()
let screen = t.captureCharFrame()
assert(screen.includes('not started') && screen.includes('Type a request'), 'before it starts the panel says so')
assert(screen.includes('frontend → claude opus'), 'a valid rule is listed')
assert(screen.includes('✗ #2') && screen.includes('not advertised'), 'a rejected rule is shown with its problem, not hidden')

for (const char of 'fix login') await press(char, char)
await settle(40)
assert(t.captureCharFrame().includes('› fix login'), 'typing fills the request line')
await press('return')
await settle(120)
assert.deepEqual(started, [{ cwd: '/p', provider: 'claude', request: 'fix login' }], 'Enter hands the request over, starting the Chief of Staff')
screen = t.captureCharFrame()
assert(screen.includes('running') && screen.includes('Build form · in_progress · fe (codex)'), 'the board appears once it runs')
assert(screen.indexOf('NEEDS YOU') < screen.indexOf('WORKSTREAMS') && screen.includes('Migrate db is blocked'), 'what needs the user leads')

await press('return')
await settle(40)
assert.deepEqual(opened, ['cos-1'], 'an empty line opens the existing chat')

assert(screen.includes('LATEST REPORT') && screen.includes('Two things need you.'), 'the latest report is on the panel')

// Rules editor: Tab to the list, add a rule as a line, edit it, delete on the second x.
const typeLine = async (text: string) => { for (const char of text) await press(char === ' ' ? 'space' : char, char) }
await press('tab'); await settle(40)
assert(t.captureCharFrame().includes('a add') && t.captureCharFrame().includes('› frontend → claude opus'), 'Tab moves to the rules list and marks the selected rule')
await press('a'); await typeLine('db | codex | gpt | high | no-worktree'); await settle(40)
assert(t.captureCharFrame().includes('new rule › db | codex | gpt | high | no-worktree'), 'adding opens an edit line')
await press('return'); await settle(80)
assert.deepEqual(saved.at(-1)?.[1], { match: 'db', provider: 'codex', model: 'gpt', effort: 'high', worktree: false }, 'Enter saves the new rule through the service')
assert(t.captureCharFrame().includes('db → codex gpt'), 'the saved rule is listed')
await press('e'); await settle(40)
assert(t.captureCharFrame().includes('rule 2 › db | codex | gpt | high | no-worktree'), 'editing starts from the rule as a line')
await press('return'); await settle(80)
await press('a'); await typeLine('bad | nope'); await press('return'); await settle(80)
assert(t.captureCharFrame().includes('new rule › bad | nope'), 'a refused save keeps the edit line open to fix')
await press('escape'); await settle(40)
saved.length = 0
await press('x'); await settle(40)
assert.equal(saved.length, 0, 'the first x only arms the delete')
assert(t.captureCharFrame().includes('x again deletes'), 'the footer says what the second x does')
await press('x'); await settle(80)
assert.equal(saved.length, 1, 'the second x deletes')
await press('tab'); await settle(40)
assert(t.captureCharFrame().includes('tab rules'), 'Tab returns to the request line')

seedChiefOfStaffRequest('  review the auth module ')
await settle(120)
assert.equal(started.at(-1)?.request, 'review the auth module', '/cos <request> reaches an open panel')
t.renderer.destroy?.()
console.log('chiefOfStaffViewSmoke ok')
process.exit(0)
