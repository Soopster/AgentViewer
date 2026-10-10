/** @jsxImportSource @opentui/react */
import assert from 'node:assert/strict'
import React, { act, useState } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'

const fixture = mkdtempSync(path.join(tmpdir(), 'coord-attention-'))
process.chdir(fixture)
execFileSync('git', ['init', '-q'])
writeFileSync('README.md', 'fixture\n')
execFileSync('git', ['add', '.'])
execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'fixture'])
const coord = await import('../../lib/agentCoordination')
const store = await import('./interactiveCoordinatorStore')
const { TeammatesAttention } = await import('./TeammatesAttention')
const { LIGHT_THEME } = await import('../theme')
const session: Session = { sessionId: 'attention-chat', provider: 'codex', cwd: fixture, summary: 'Background team' }
await coord.configureInteractiveCoordinator({ sessionId: session.sessionId, provider: 'codex', cwd: fixture, autoContinue: false })
const lead = await coord.sessionCoordinatorIdentity(session.sessionId, 'codex')
const worker = (await coord.joinExternalProtocolRun({ runId: lead.runId, participantName: 'reviewer', provider: 'codex', cwd: fixture })).participant
await coord.sendExternalProtocolMessage(worker, { to: 'lead', body: 'Which parser should I review?', replyRequired: true })

let select!: (session: Session | null) => void
function ReaderFixture() {
  const [current, setCurrent] = useState<Session | null>(null)
  select = setCurrent
  return <TeammatesAttention session={current} width={100} theme={LIGHT_THEME} />
}
const setup = await testRender(<ReaderFixture />, { width: 100, height: 8 })
async function settle(check: () => boolean, label: string) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 20)) })
    if (check()) return
  }
  assert.fail(`${label}\n${setup.captureCharFrame()}`)
}
try {
  await act(async () => select({ ...session, isPending: true }))
  await setup.flush()
  assert.equal(store.getInteractiveCoordinatorAttention(), '', 'an unsent conversation must not be observed')
  await act(async () => select(session))
  await settle(() => setup.captureCharFrame().includes('1 need attention'), 'Selecting a conversation must discover its existing team')
  assert.equal(store.getInteractiveCoordinatorState().open, false, 'attention must not open the panel')
  assert.equal(store.getInteractiveCoordinatorState().session, null, 'attention must not change panel focus')
  await act(async () => select({ sessionId: 'ordinary-chat', provider: 'codex', cwd: fixture }))
  await act(async () => { await coord.sendExternalProtocolMessage(worker, { to: 'lead', body: 'Should I include tests?', replyRequired: true }) })
  await settle(() => setup.captureCharFrame().includes('2 need attention'), 'Navigating away must preserve live team attention')
  await act(async () => store.openInteractiveCoordinatorAttention())
  assert.equal(store.getInteractiveCoordinatorState().session?.sessionId, session.sessionId)
  assert.equal((await coord.readSessionCoordinator(session.sessionId, 'codex'))!.messages.filter(message => message.replyRequired && !message.resolvedAt).length, 2,
    'viewing attention must not answer or consume teammate questions')
  await act(async () => { store.closeInteractiveCoordinator(); await coord.stopProtocolRun(lead.runId) })
  await settle(() => !setup.captureCharFrame().includes('need attention'), 'Stopping a room must retire unanswerable prompts')
  assert.equal((await coord.readSessionCoordinator(session.sessionId, 'codex'))!.messages.filter(message => message.replyRequired && !message.resolvedAt).length, 2,
    'retiring obsolete attention must not pretend the questions were answered')
  console.log('Rendered passive attention: automatic discovery, navigation, pending-session exclusion, and stopped-room cleanup preserve unanswered history')
} finally {
  await act(async () => setup.renderer.destroy())
  store.resetInteractiveCoordinatorStore()
  await coord.stopProtocolRun(lead.runId)
}
process.exit(0)
