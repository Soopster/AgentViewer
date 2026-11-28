/** @jsxImportSource @opentui/react */
// The Second Opinion view: turns with their review state, a review that takes
// two presses (it spends model usage), findings with excerpts, the hand-off to
// the composer, dismiss, the reviewer switch and the auto-review toggle.
import React, { useState } from 'react'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { module } from '../../plugins/second-opinion/tui'
import type { SecondOpinionRecord, SecondOpinionSettings, SecondOpinionSnapshot } from '../../lib/plugins/secondOpinion'
import type { TurnCheckpoint } from '../../lib/checkpoints'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const now = Date.now()
const turns: TurnCheckpoint[] = [
  { ref: 'r2', sha: 'bbb', createdAt: now - 60_000, label: 'add readme', sessionId: 's', provider: 'claude' },
  { ref: 'r1', sha: 'aaa', createdAt: now - 3_600_000, label: 'add divide', sessionId: 's', provider: 'claude' },
]
const reviewed: SecondOpinionRecord = {
  id: 'rev1', checkpointSha: 'aaa', untilSha: 'bbb', endTree: 't', turnLabel: 'add divide', sessionId: 's', authorProvider: 'claude',
  reviewer: 'codex', model: 'gpt-x', auto: false, status: 'done', startedAt: now - 3_000_000, finishedAt: now - 2_900_000, dismissed: [],
  review: {
    summary: 'Adds divide without a zero guard.', unread: [], files: ['math.ts'],
    findings: [
      { id: 'f1', severity: 'bug', title: 'Division by zero', why: 'b can be zero.', suggestion: 'Guard b.', excerpts: [{ path: 'math.ts', startLine: 6, endLine: 6, lines: ['+  return a / b'] }] },
      { id: 'f2', severity: 'nit', title: 'Name the export', why: 'Clarity.', suggestion: '', excerpts: [{ path: 'math.ts', startLine: 5, endLine: 5, lines: ['+export function divide(a: number, b: number) {'] }] },
    ],
  },
}
let settings: SecondOpinionSettings = { autoReview: false, reviewer: 'auto', models: { claude: 'claude-opus-5-5', codex: '' } }
let reviews: SecondOpinionRecord[] = [reviewed]
const calls: string[] = []
const inserted: string[] = []
const opened: string[] = []
const services = {
  repository: { cwd: '/repo', sessionId: null },
  checkpoints: { list: async () => turns },
  'second-opinion': {
    read: async (): Promise<SecondOpinionSnapshot> => ({ cwd: '/repo', settings, reviews }),
    start: async (_cwd: string, input: { checkpointSha: string; reviewer?: string }) => {
      calls.push(`start:${input.checkpointSha}:${input.reviewer}`)
      reviews = [{ ...reviewed, id: 'rev2', checkpointSha: input.checkpointSha, status: 'running', reviewer: input.reviewer as 'codex', review: undefined }, ...reviews]
      return { id: 'rev2' }
    },
    cancel: async (_cwd: string, id: string) => { calls.push(`cancel:${id}`) },
    dismiss: async (_cwd: string, id: string, finding: string) => { calls.push(`dismiss:${id}:${finding}`); reviews = reviews.map(r => r.id === id ? { ...r, dismissed: [...r.dismissed, finding] } : r) },
    configure: async (_cwd: string, next: Partial<SecondOpinionSettings>) => { calls.push(`configure:${JSON.stringify(next)}`); settings = { ...settings, ...next }; return settings },
  },
  composer: { insertText: (text: string) => { inserted.push(text) }, appendDiffNote: () => {} },
  'open-file': { open: (file: string, line?: number | null) => { opened.push(`${file}:${line}`) } },
}

let keys: (key: any) => boolean | void = () => false
let closed = 0
const View = module.views['second-opinion'] as any
const size = { width: 130, height: 34 }
function Host() {
  const store = React.useRef(new Map<string, unknown>())
  const scoped = <T,>(name: string, initial: T) => {
    const [value, setValue] = useState<T>(() => (store.current.has(name) ? store.current.get(name) as T : initial))
    return [value, (next: T | ((previous: T) => T)) => setValue(previous => { const resolved = typeof next === 'function' ? (next as (p: T) => T)(previous) : next; store.current.set(name, resolved); return resolved })] as const
  }
  return <View services={services} theme={DARK_THEME} width={size.width} height={size.height} placement="window" zIndex={1} focused
    useState={scoped} registerKeys={(h: any) => { if (h) keys = h }} close={() => { closed++ }} setCapture={() => {}} />
}
const t = await testRender(<Host />, size)
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 60)) })
const press = async (name: string, sequence = name) => { await act(async () => { keys({ name, sequence, ctrl: false, shift: false }); await new Promise(r => setTimeout(r, 40)) }); await t.flush?.() }
const frame = async () => { await settle(); await t.renderOnce(); return t.captureCharFrame() }

let screen = await frame()
assert(screen.includes('TURNS') && screen.includes('FINDINGS'), 'two panes at this width')
assert(screen.includes('add readme') && screen.includes('add divide'), 'every checkpointed turn is listed')
assert(screen.includes('Not reviewed yet. r reviews with codex'), 'an unreviewed Claude turn offers Codex')

// Reviewing takes two presses.
await press('r')
screen = await frame()
assert(!calls.some(c => c.startsWith('start')), 'one r starts nothing')
assert(screen.includes('Press again'), 'the first r says what the second will do')
await press('r')
assert(calls.includes('start:bbb:codex'), 'the second r reviews the selected turn with the default reviewer')
screen = await frame()
assert(screen.includes('codex reviewing'), 'the running review shows on the turn')

// The reviewed turn: findings, excerpts, hand-off, open, dismiss.
await press('j')
screen = await frame()
assert(screen.includes('Division by zero') && screen.includes('return a / b'), 'the selected finding shows its excerpt')
assert(screen.includes('1 bug · 1 nit'), 'the header counts open findings by severity')
await press('right')
await press('c')
assert(inserted.length === 1 && inserted[0]!.includes('[bug] Division by zero') && inserted[0]!.includes('math.ts lines 6-6'), 'c hands the finding to the composer with where it is')
await press('return')
assert(opened.includes('math.ts:6'), 'Enter opens the finding where it points')
await press('x')
screen = await frame()
assert(calls.includes('dismiss:rev1:f1'), 'x dismisses the selected finding')
assert(!screen.includes('Division by zero') && screen.includes('Name the export'), 'a dismissed finding leaves the list')

// Reviewer switch and auto-review.
await press('left')
await press('o')
screen = await frame()
assert(screen.includes('r review (claude)'), 'o switches the next reviewer')
await press('a')
screen = await frame()
assert(calls.some(c => c.startsWith('configure:') && c.includes('"autoReview":true')) && screen.includes('auto-review on'), 'a turns auto-review on and the header says so')

await press('escape')
assert(closed === 1, 'Escape closes')
t.renderer.destroy?.()
console.log('secondOpinionSmoke ok')
process.exit(0)
