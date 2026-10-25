/** @jsxImportSource @opentui/react */
import React, { useState } from 'react'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReviewRequest } from '../../lib/review/types'
import { emptyReview } from '../../lib/review/types'
import { RetainedWindow } from './windowActivity'
import { DARK_THEME } from '../theme'
import { testRender, act } from './testRender'

let reads = 0
const publications: ReviewRequest[] = []
const specifier = 'bun:test'
const { mock } = await import(specifier) as { mock: { module(name: string, factory: () => unknown): void } }
mock.module('../../lib/review/localTransport', () => ({ localReviewTransport: {
  read: async (_cwd: string, source: string) => { reads++; return emptyReview(source) },
  mutate: async (request: ReviewRequest) => {
    publications.push(request)
    return { ...emptyReview(request.source), sequence: publications.length }
  },
} }))
const { GitReviewPopover } = await import('../../plugins/git/tui/GitPopover')
const cwd = await mkdtemp(join(tmpdir(), 'git-window-activity-'))
let show!: (visible: boolean) => void
function Harness() {
  const [visible, setVisible] = useState(true)
  show = setVisible
  return <box visible={visible}><RetainedWindow visible={visible}>
    <GitReviewPopover cwd={cwd} theme={DARK_THEME} width={120} height={40}
      onClose={() => {}} onKeyHandlerReady={() => {}} />
  </RetainedWindow></box>
}
try {
  execFileSync('git', ['init', '-q'], { cwd })
  await writeFile(join(cwd, 'example.ts'), 'export const value = 1\n')
  execFileSync('git', ['add', '.'], { cwd })
  execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'base'], { cwd })
  await writeFile(join(cwd, 'example.ts'), 'export const value = 2\n')
  const setup = await testRender(<Harness />, { width: 120, height: 40 })
  const settle = async (ms: number) => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); await setup.flush() })
  }
  try {
    for (let attempt = 0; attempt < 20 && !publications.some(request => request.publish?.patch); attempt++) await settle(100)
    assert.ok(reads > 0, 'visible Git review reads its shared state')
    assert.ok(publications.some(request => request.publish?.patch), 'visible Git review publishes the current patch')
    await act(async () => show(false))
    await settle(100)
    assert.ok(publications.at(-1)?.publish?.close, 'hiding releases the review view lease')
    const hiddenReads = reads
    const hiddenPublications = publications.length
    // Cross both the 1s poll and 5s heartbeat boundaries.
    await settle(5200)
    assert.equal(reads, hiddenReads, 'hidden review does not poll')
    assert.equal(publications.length, hiddenPublications, 'hidden review does not send heartbeats')
    await act(async () => show(true))
    await settle(100)
    assert.ok(reads > hiddenReads, 'resume immediately reads shared review state')
    assert.ok(publications.slice(hiddenPublications).some(request => request.publish?.patch), 'resume reopens the view with its current patch')
  } finally { act(() => setup.renderer.destroy()) }
} finally { await rm(cwd, { recursive: true, force: true }) }
console.log('Git window activity passed: zero hidden review polls/heartbeats and immediate resume')
process.exit(0)
