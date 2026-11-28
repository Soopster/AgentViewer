/** @jsxImportSource @opentui/react */
// ⇧U with Second Opinion on: a reviewed turn carries its verdict, its diff shows each finding
// under the line it is about, and the working diff's hunks carry the newest turn's findings.
// With the service absent the popover is unchanged.
import React from 'react'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { CheckpointPopover } from '../../plugins/checkpoints/tui/CheckpointPopover'
import type { SecondOpinionSnapshot } from '../../lib/plugins/secondOpinion'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const now = Date.now()
const diff = ['diff --git a/math.ts b/math.ts', '--- a/math.ts', '+++ b/math.ts', '@@ -3,0 +4,3 @@', '+export function divide(a: number, b: number) {', '+  return a / b', '+}'].join('\n')
const checkpoints = {
  list: async () => [{ ref: 'r1', sha: 'aaa', createdAt: now - 60_000, label: 'add divide', sessionId: 's', provider: 'claude' }],
  working: async () => ({ untracked: ['parse.ts'], hunks: [{ file: 'math.ts', header: '@@ -3,0 +4,3 @@', lines: ['@@ -3,0 +4,3 @@', '+export function divide(a: number, b: number) {', '+  return a / b', '+}'], patch: '' }] }),
  changes: async () => [{ status: 'M' as const, path: 'math.ts' }],
  diff: async () => diff,
} as any
const snapshot: SecondOpinionSnapshot = {
  cwd: '/repo', settings: { autoReview: false, reviewer: 'auto', models: { claude: '', codex: '' } },
  reviews: [{ id: 'r', checkpointSha: 'aaa', untilSha: null, endTree: 't', turnLabel: 'add divide', reviewer: 'codex', model: '', auto: false, status: 'done', startedAt: now, dismissed: [], stale: false,
    review: { summary: 's', unread: [], files: ['math.ts', 'parse.ts'], findings: [{ id: 'f2', severity: 'risk', title: 'NaN on bad input', why: 'w', suggestion: '', excerpts: [{ path: 'parse.ts', startLine: 2, endLine: 2, lines: ['+  return x'] }] }, { id: 'f1', severity: 'bug', title: 'Division by zero', why: 'w', suggestion: '', excerpts: [{ path: 'math.ts', startLine: 5, endLine: 5, lines: ['+  return a / b'] }] }] } }],
}
const secondOpinion = { read: async () => snapshot } as any

async function mount(withOpinion: boolean) {
  let keys: (key: any) => void = () => {}
  const t = await testRender(<CheckpointPopover cwd="/repo" service={checkpoints} theme={DARK_THEME} accentColor={DARK_THEME.cyan} width={110} height={30}
    onClose={() => {}} onNotice={() => {}} onKeyHandlerReady={handler => { keys = handler }} docked {...(withOpinion ? { secondOpinion } : {})} />, { width: 110, height: 30 })
  const press = async (name: string, sequence = name) => { await act(async () => { keys({ name, sequence, ctrl: false, shift: false }); await new Promise(r => setTimeout(r, 60)) }) }
  const frame = async () => { await act(async () => { await new Promise(r => setTimeout(r, 80)) }); await t.renderOnce(); return t.captureCharFrame() }
  return { t, press, frame }
}

let view = await mount(true)
let screen = await view.frame()
assert(screen.includes('◎ 1 bug · 1 risk'), 'a reviewed turn carries its verdict')
await view.press('d')
screen = await view.frame()
const lines = screen.split('\n')
const at = lines.findIndex(line => line.includes('+  return a / b'))
assert(at >= 0 && lines[at + 1]!.includes('◎ ✖ bug: Division by zero'), 'the finding sits directly under the line it is about')
await view.press('escape')
await view.press('tab')
screen = await view.frame()
assert(screen.includes('◎ ✖ bug: Division by zero'), 'the working diff hunk carries the newest turn\'s finding')
assert(screen.includes('◎ ▲ risk: NaN on bad input'), 'an untracked file carries the findings about it')
view.t.renderer.destroy?.()

view = await mount(false)
screen = await view.frame()
assert(!screen.includes('◎'), 'without Second Opinion the popover shows no review marks')
view.t.renderer.destroy?.()
console.log('checkpointOpinionSmoke ok')
process.exit(0)
