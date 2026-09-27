/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { testRender } from '@opentui/react/test-utils'
import { GitPopover } from './GitPopover'
import { DARK_THEME } from '../theme'
import { readReview, mutateReview } from '../../lib/review/store'
import type { ReviewActionKey } from './useGitDiffReviewActions'

const cwd = await mkdtemp(join(tmpdir(), 'review-ui-'))
  process.env.AGENT_VIEWER_REVIEW_DIR = join(cwd, '.reviews')
const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
let key: ((event: ReviewActionKey) => void) | undefined
try {
  git('init', '-q')
  await writeFile(join(cwd, 'a.ts'), 'old\ncontext\n')
  await writeFile(join(cwd, 'b.ts'), 'before\n')
  git('add', '.'); git('-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'base')
  await writeFile(join(cwd, 'a.ts'), 'new\ncontext\n')
  await writeFile(join(cwd, 'b.ts'), 'after\n')
  const setup = await testRender(<GitPopover cwd={cwd} theme={DARK_THEME} width={145} height={40} onClose={() => {}} onKeyHandlerReady={handler => { key = handler }} />, { width: 145, height: 40 })
  const frame = () => setup.captureCharFrame()
  const flush = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 50)) }); await setup.flush() }
  const press = async (sequence: string) => { await act(async () => { key?.({ name: sequence, sequence, ctrl: false, shift: sequence === 'R' }) }); await flush() }
  const until = async (check: () => boolean | Promise<boolean>, label: string) => {
    for (let i = 0; i < 120; i++) { if (await check()) return; await flush() }
    assert.fail(`${label}\n${frame()}`)
  }
  try {
    await until(async () => (await readReview(cwd, 'working')).document.hunks.length === 2, 'publishes complete review')
    await press('R'); await until(() => frame().includes('0/2 approved'), 'board opens')
    await press('a'); await until(() => frame().includes('1/2 approved'), 'approval persists')
    await press('n'); await press('b'); await until(() => frame().includes('blocked'), 'next unresolved and block')
    await press('r'); for (const char of 'boundary risk') await press(char); await press('return')
    await until(async () => (await readReview(cwd, 'working')).decisions.some(item => item.rationale === 'boundary risk'), 'rationale saved')
    await press('escape')
    let state = await readReview(cwd, 'working')
    state = await mutateReview({ cwd, source: 'working', requestId: randomUUID(), operation: { type: 'note', revision: state.document.revision, filePath: 'a.ts', range: { start: 1, end: 1, side: 'additions' }, text: 'Agent explanation', author: 'agent' } })
    await until(() => frame().includes('Agent explanation'), 'agent note arrives inline')
    await mutateReview({ cwd, source: 'working', requestId: 'navigate-live', operation: { type: 'navigate', revision: state.document.revision, viewId: state.views[0]!.id, target: { filePath: 'b.ts', hunkId: state.document.hunks.find(hunk => hunk.filePath === 'b.ts')!.id } } })
    await until(async () => !!(await readReview(cwd, 'working')).views[0]?.navigation?.appliedAt, 'live navigation acknowledged')
    await press('R'); await press('j'); await press('j'); await press('r')
    for (const char of 'Human reply') await press(char)
    await press('return')
    await until(async () => (await readReview(cwd, 'working')).notes[0]?.replies[0]?.text === 'Human reply', 'human replies to agent')
    await press('escape')
    await writeFile(join(cwd, 'a.ts'), 'different\ncontext\n')
    await press('r')
    await until(async () => (await readReview(cwd, 'working')).notes[0]?.resolution === 'stale', 'refresh detects stale note')
    await press('R'); await until(() => frame().includes('stale'), 'stale note retained in board')
    assert.equal((await readReview(cwd, 'working')).decisions.length, 1, 'only changed hunk decision invalidated')
  } finally { act(() => setup.renderer.destroy()); await new Promise(resolve => setTimeout(resolve, 100)) }
  console.log('Review workflow smoke passed: checklist, rationale, agent notes, human reply, live navigation acknowledgment, stale note visibility')
} finally { await rm(cwd, { recursive: true, force: true }) }
