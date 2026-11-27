/** @jsxImportSource @opentui/react */
// The terminal review guide: writing takes two presses (it spends model usage),
// stops step, and asking carries the stop's lines to the agent.
import assert from 'node:assert/strict'
import React from 'react'
import { DARK_THEME } from '../theme'
import type { PrGuide } from '../../lib/github/guide'
import { GuidePanel } from '../../plugins/pull-requests/tui/GuidePanel'
import { act, testRender } from './testRender'

const guide: PrGuide = {
  repo: 'o/r', number: 3, headOid: 'abc', writtenAt: 1, model: 'm', summary: 'What it does.', mechanical: ['lock.json'], uncovered: [], unread: [],
  stops: [
    { title: 'First stop', why: 'It matters.', lookClosely: true, question: 'Is it safe?', excerpts: [{ path: 'a.ts', startLine: 1, endLine: 2, lines: ['+const first = 1'] }] },
    { title: 'Second stop', why: 'Then this.', lookClosely: false, question: '', excerpts: [{ path: 'b.ts', startLine: 5, endLine: 5, lines: ['-const gone = 2'] }] },
  ],
}
let writes = 0
const asked: string[] = []
const opened: string[] = []
const keys = { current: (_key: { name: string; ctrl: boolean; shift: boolean; sequence: string }) => {} }
const services = { read: async () => null, write: async () => { writes++; return guide } }
const pr = { number: 3, url: 'https://github.com/o/r/pull/3', headRefOid: 'zzz' }
const setup = await testRender(
  <GuidePanel cwd="/x" pr={pr} theme={DARK_THEME} width={100} height={30} keyRef={keys} onClose={() => {}} onAsk={prompt => asked.push(prompt)} onOpenFile={file => opened.push(file)} services={services} />,
  { width: 100, height: 30 },
)
const settle = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 80)); await setup.flush() }) }
const press = async (name: string, sequence = name) => { await act(async () => { keys.current({ name, ctrl: false, shift: false, sequence }) }); await settle() }
try {
  await settle()
  assert.match(setup.captureCharFrame(), /No guide yet/)
  await press('w', 'W')
  assert.equal(writes, 0, 'the first press only asks')
  assert.match(setup.captureCharFrame(), /W again writes it/)
  await press('j'); await press('w', 'W')
  assert.equal(writes, 0, 'another key cancels the confirmation')
  await press('w', 'W')
  assert.equal(writes, 1)
  assert.match(setup.captureCharFrame(), /1\/2/)
  assert.match(setup.captureCharFrame(), /Look closely/)
  assert.match(setup.captureCharFrame(), /changed since this guide/)
  await press('l')
  assert.match(setup.captureCharFrame(), /Second stop/)
  assert.match(setup.captureCharFrame(), /lock\.json/)
  await press('?')
  assert.match(asked[0]!, /b\.ts lines 5-5/)
  await press('return')
  assert.deepEqual(opened, ['b.ts'])
  console.log('prGuideSmoke: PASS')
} finally {
  await act(async () => { setup.renderer.destroy() })
}
process.exit(0)
