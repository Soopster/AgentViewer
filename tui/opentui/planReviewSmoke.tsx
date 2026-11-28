/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { testRender, act } from './testRender'
import { DARK_THEME } from '../theme'
import { module } from '../../plugins/plan-review/tui'
import { publishPlan, readPlans } from '../../lib/plan-review/store'
import { nativePlanReview, deliverPlan } from '../../lib/plan-review/service'
import { latestPlan, planApproved, planNotes, type PlanReviewService } from '../../lib/plugins/planReview'
import type { TuiPluginViewProps, TuiPluginKeyHandler } from './shell/pluginTypes'
const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'plan-review-tui-'))), cwd = path.join(temp, 'repo')
await mkdir(cwd); process.env.AGENT_VIEWER_PLAN_REVIEW_DIR = path.join(temp, 'data')
const target = { provider: 'codex' as const, providerInstanceId: 'work', sessionId: 'review-source' }
const source = { kind: 'message' as const, target, messageId: 'm1', automatic: true }
await publishPlan(cwd, source, '# Terminal plan\n\nKeep the API.\nAdd tests.\n')
let handler: TuiPluginKeyHandler | null = null, deliveries = 0
const service: PlanReviewService = { ...nativePlanReview, read: async () => ({ reviews: await readPlans(cwd) }), send: (root, input) => deliverPlan(root, input, async () => { deliveries++ }) }
const View = module.views['plan-review']!
let setSize: ((value: { width: number; height: number }) => void) | undefined
let setEmpty: ((value: boolean) => void) | undefined
const emptyService: PlanReviewService = { ...service, read: async () => ({ reviews: [] }) }
let setFocused: ((value: boolean) => void) | undefined
function Harness() {
  const [size, resize] = React.useState({ width: 110, height: 36 }); setSize = resize
  const [empty, updateEmpty] = React.useState(false); setEmpty = updateEmpty
  const [focused, update] = React.useState(true); setFocused = update
  const props: TuiPluginViewProps = { pluginId: 'plan-review', surfaceId: 'plan-review', instanceId: 'tui-review', placement: 'panel', target: { cwd, sessionKey: 'source' }, services: { 'plan-review': empty ? emptyService : service, repository: { cwd, sessionId: target.sessionId }, session: { session: { ...target, cwd } as never } }, theme: DARK_THEME, accent: DARK_THEME.cyan, syntaxStyle: null, ...size, focused, zIndex: 50, useState: ((_name: string, initial: unknown) => React.useState(initial)) as never, onDispose: () => () => {}, registerKeys: value => { handler = value }, setCapture: () => {}, runCommand: () => false, close: () => {} }
  return <View {...props} />
}
const setup = await testRender(<Harness />, { width: 110, height: 36 })
async function waitFor(label: string, predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 80; i++) { let matched = false; await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); await setup.flush(); matched = await predicate() }); if (matched) return }
  throw new Error(`${label}\n${setup.captureCharFrame()}`)
}
async function key(name: string, ctrl = false) { await act(async () => { handler?.({ name, sequence: name, ctrl, shift: false }); await new Promise(resolve => setTimeout(resolve, 30)); await setup.flush() }) }
async function click(label: string) {
  const rows = setup.captureCharFrame().split('\n'), y = rows.findIndex(row => row.includes(label))
  assert(y >= 0, `Missing clickable label: ${label}\n${rows.join('\n')}`)
  await act(async () => { await setup.mockMouse.click(rows[y].indexOf(label) + 1, y); await setup.flush() })
}
try {
  await waitFor('plan renders', () => setup.captureCharFrame().includes('Terminal plan'))
  assert(setup.captureCharFrame().includes('[1] Plans (1)'))
  assert(!setup.captureCharFrame().includes('b replace conflicted draft'), 'full help stays collapsed')
  await key('?'); await waitFor('help expands', () => setup.captureCharFrame().includes('replace conflicted draft'))
  await key('?')
  await click('[a] Approve'); await waitFor('approval persisted', async () => planApproved((await readPlans(cwd))[0]))
  assert.equal(deliveries, 0)
  await key('i'); await waitFor('implementation sent', () => deliveries === 1)
  await waitFor('receipt renders', () => setup.captureCharFrame().includes('implement · sent'))
  await act(async () => setFocused?.(false))
  assert.equal((handler as TuiPluginKeyHandler | null)?.({ name: 'a', sequence: 'a', ctrl: false, shift: false }), false)
  await act(async () => setFocused?.(true))
  await key('j'); await key('j'); await key('v'); await key('j'); await key('d')
  await waitFor('deletion composer', () => setup.captureCharFrame().includes('deletion · Ctrl+S saves'))
  await key('s', true)
  await waitFor('annotation persists', async () => planNotes((await readPlans(cwd))[0]).length === 1)
  const annotated = (await readPlans(cwd))[0]
  assert.equal(planNotes(annotated)[0].anchor?.quote, 'Keep the API.\nAdd tests.')
  assert(!planApproved(annotated), 'changing feedback invalidates approval')
  await click('Notes (1)'); await waitFor('notes tab renders', () => setup.captureCharFrame().includes('Line 3'))
  await key('z'); await waitFor('note resolves', async () => Boolean(planNotes((await readPlans(cwd))[0])[0].resolved))
  await key('z'); await waitFor('note reopens', async () => !planNotes((await readPlans(cwd))[0])[0].resolved)
  await key('left')
  await key('r'); await waitFor('feedback delivered', () => deliveries === 2)
  await key('h'); await waitFor('history renders', () => setup.captureCharFrame().includes('comparison with previous'))
  assert.equal(latestPlan((await readPlans(cwd))[0]).text.includes('Terminal plan'), true)
  await key('escape')
  await key('n', true); await waitFor('sidebar collapses', () => !setup.captureCharFrame().includes('[1] Plans'))
  await key('1'); await waitFor('sidebar returns', () => setup.captureCharFrame().includes('[1] Plans'))
  await key('2')
  await act(async () => { setup.resize(64, 20); setSize?.({ width: 64, height: 20 }) })
  await waitFor('narrow plan fits', () => setup.captureCharFrame().includes('[i] Implement'))
  assert(!setup.captureCharFrame().includes('[1] Plans'), 'narrow layout reserves width for document')
  await key('1'); await waitFor('narrow drawer opens', () => setup.captureCharFrame().includes('[1] Plans'))
  await key('return'); await waitFor('narrow drawer closes', () => !setup.captureCharFrame().includes('[1] Plans'))
  await act(async () => setEmpty?.(true))
  await waitFor('empty state actions', () => setup.captureCharFrame().includes('Start a plan review') && setup.captureCharFrame().includes('[f] Open a Markdown file'))
  assert(!setup.captureCharFrame().includes('Needs review'), 'empty state has no review decision')
  await key('f'); await waitFor('file editor opens', () => setup.captureCharFrame().includes('Repository Markdown path'))
  await key('escape')
  await act(async () => { setup.resize(110, 36); setSize?.({ width: 110, height: 36 }) })
  await waitFor('wide empty state keeps navigation', () => setup.captureCharFrame().includes('[1] Plans (0)') && setup.captureCharFrame().includes('Start a plan review'))
  console.log('Plan Review OpenTUI: PASS (keyboard range, annotation editing, approval, explicit implementation, receipts, focus gating, feedback, history, clickable tabs/actions, help, responsive sidebar, empty state)')
} finally { await act(async () => setup.renderer.destroy()); await rm(temp, { recursive: true, force: true }) }
process.exit(0)
