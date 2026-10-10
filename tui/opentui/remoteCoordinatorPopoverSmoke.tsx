/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startRemoteMachineFixture } from '../../scripts/coordRemoteMachineHarness'
import type { Session } from '../../lib/types'

process.chdir(mkdtempSync(path.join(tmpdir(), 'remote-coordinator-ui-')))
const { machine, child } = await startRemoteMachineFixture('render-box')
try {
  const machines = await import('../../lib/machines.mjs')
  machines.writeMachines([machine])
  const { mock } = await (0, eval)('import("bun:test")')
  const local: Session = { sessionId: 'local-reader', provider: 'codex', cwd: process.cwd(), summary: 'Local conversation', lastModified: Date.now() }
  const detail = { info: { sessionId: local.sessionId, provider: 'codex' as const, cwd: process.cwd() }, rawMessages: [], threadedMessages: [], transcriptCards: [], contextUsage: null }
  const detailClient = await import('./sessionDetailWorkerClient')
  mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => [local], readTuiSessionDetailAsync: async () => detail }))
  const metadata = await import('./metadataWorkerClient')
  mock.module('./metadataWorkerClient', () => ({ ...metadata, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
  const service = await import('../../lib/tui/service')
  mock.module('../../lib/tui/service', () => ({ ...service, readTuiSessions: async () => [local], readTuiSessionDetail: async () => detail,
    readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
    readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }), listTuiRunningSessions: async () => [], prewarmTuiSession: async () => {},
  }))
  const drafts = await import('../../lib/tuiComposerState')
  drafts.scheduleWriteComposerDraft('codex:local-reader', 'Keep my local draft')
  const store = await import('./coordinatorStore')
  const { default: App } = await import('./App')
  const [width, height] = (process.env.REMOTE_PANEL_SIZE || '110x36').split('x').map(Number)
  const setup = await testRender(<App />, { width, height, kittyKeyboard: true })
  const settle = async (ms = 60) => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, ms)) }) }
  const until = async (label: string, check: () => boolean) => {
    const deadline = Date.now() + 7000
    while (Date.now() < deadline) { if (check()) return; await settle() }
    assert.fail(`${label}\n${setup.captureCharFrame()}`)
  }
  await settle(2500)
  act(() => setup.mockInput.pressKey('a'))
  await until('remote roster appears in the real root', () => store.getCoordinatorState().agentEntries.some(entry => entry.machine?.name === machine.name && entry.agent.id === 'shared-agent'))
  const row = store.getCoordinatorState().agentEntries.find(entry => entry.machine?.name === machine.name && entry.agent.id === 'shared-agent')!
  act(() => store.setCoordinatorSelectedKey(row.key))
  await settle()
  act(() => setup.mockInput.pressEnter())
  await until('remote inspector opens through the root selection handler', () => setup.captureCharFrame().includes('REMOTE · render-box'))
  await until('remote transcript and question render', () => setup.captureCharFrame().includes('render-box transcript') && setup.captureCharFrame().includes('render-box question'))
  act(() => setup.mockInput.pressKey('m'))
  await settle()
  assert.ok(setup.captureCharFrame().includes('Reply:'), `m targets the visible unanswered question\n${setup.captureCharFrame()}`)
  for (const key of 'Strict policy') { act(() => setup.mockInput.pressKey(key)); await settle(1) }
  act(() => setup.mockInput.pressEnter())
  await until('remote reply confirms', () => setup.captureCharFrame().includes('Remote action confirmed'))
  const ledgerResponse = await fetch(`${machine.baseUrl}/fixture`, { headers: machines.machineHeaders(machine) })
  if (!ledgerResponse.ok) throw new Error('Fixture ledger read failed')
  const ledger = await ledgerResponse.json()
  const question = ledger.snapshot.messages.find((message: { body: string }) => message.body === 'render-box question')
  assert.ok(question.resolvedAt, 'the rendered key path resolves the original remote question')
  assert.equal(ledger.snapshot.messages.filter((message: { body: string }) => message.body === 'Strict policy').length, 1)
  assert.equal(drafts.readComposerDraft('codex:local-reader'), 'Keep my local draft', 'remote input never edits the local composer')
  const control = async (body?: unknown) => {
    const response = await fetch(`${machine.baseUrl}/fixture`, { headers: { ...machines.machineHeaders(machine), 'Content-Type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })
    assert.equal(response.status, 200)
    return response.json()
  }
  await control({ native: 'tool' })
  await until('native approval appears without switching the local session', () => setup.captureCharFrame().includes('p answer native'))
  act(() => setup.mockInput.pressKey('p'))
  await until('native inspector opens with the command', () => setup.captureCharFrame().includes('NATIVE REQUEST') && setup.captureCharFrame().includes('review-command'))
  act(() => setup.mockInput.pressEnter())
  await settle()
  assert.equal((await control()).nativeActions.length, 0, 'Enter reviews a decision and cannot accidentally approve')
  assert.ok(setup.captureCharFrame().includes('Confirm Allow?'), setup.captureCharFrame())
  act(() => setup.mockInput.pressKey('y'))
  await until('native approval confirms through owning daemon', () => !setup.captureCharFrame().includes('NATIVE REQUEST') && setup.captureCharFrame().includes('Remote action confirmed'))
  assert.equal((await control()).nativeActions.length, 1)
  await control({ native: 'question' })
  await until('native question appears', () => setup.captureCharFrame().includes('p answer native'))
  act(() => setup.mockInput.pressKey('p'))
  await until('question picker opens', () => setup.captureCharFrame().includes('Which policy?'))
  act(() => setup.mockInput.pressEnter())
  await settle()
  assert.equal((await control()).nativeActions.length, 1, 'unanswered required question cannot send')
  act(() => setup.mockInput.pressKey(' '))
  await settle()
  act(() => setup.mockInput.pressEnter())
  await until('chosen question answer requires confirmation', () => setup.captureCharFrame().includes('Confirm answers?'))
  act(() => setup.mockInput.pressKey('y'))
  await until('question answer confirms', () => !setup.captureCharFrame().includes('NATIVE REQUEST'))
  assert.deepEqual((await control()).nativeActions.at(-1).body.answers, { policy: ['Strict'] })
  await control({ native: 'tool' })
  await until('next native request appears', () => setup.captureCharFrame().includes('p answer native'))
  act(() => setup.mockInput.pressKey('p'))
  await until('next native inspector opens', () => setup.captureCharFrame().includes('NATIVE REQUEST'))
  act(() => setup.mockInput.pressEnter())
  await settle()
  await control({ native: 'changed' })
  await until('changed prompt disables an open confirmation', () => setup.captureCharFrame().includes('Request changed or answered'))
  const beforeChanged = (await control()).nativeActions.length
  act(() => setup.mockInput.pressKey('y'))
  await settle()
  assert.equal((await control()).nativeActions.length, beforeChanged)
  act(() => setup.mockInput.pressEscape())
  await settle()
  act(() => setup.mockInput.pressEscape())
  await settle()
  act(() => setup.mockInput.pressKey('p'))
  await until('changed command needs new inspection', () => setup.captureCharFrame().includes('changed-command'))
  act(() => setup.mockInput.pressEnter())
  await settle()
  act(() => setup.mockInput.pressKey('y'))
  await until('fresh command confirmation succeeds', () => !setup.captureCharFrame().includes('NATIVE REQUEST'))
  assert.equal((await control()).nativeActions.length, beforeChanged + 1)
  if (width >= 70) {
    await act(async () => {
      const response = await fetch(`${machine.baseUrl}/fixture`, { method: 'POST', headers: { ...machines.machineHeaders(machine), 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'lost' }) })
      assert.equal(response.status, 200)
    })
    act(() => setup.mockInput.pressKey('m'))
    await settle()
    for (const key of 'One remote message') { act(() => setup.mockInput.pressKey(key)); await settle(1) }
    act(() => setup.mockInput.pressEnter())
    await until('lost-response journal appears', () => setup.captureCharFrame().includes('Unconfirmed message'))
    act(() => setup.mockInput.pressEscape())
    await settle()
    act(() => setup.mockInput.pressEnter())
    await until('reopening restores pending request without sending', () => setup.captureCharFrame().includes('Unconfirmed message'))
    act(() => setup.mockInput.pressKey('m'))
    await settle()
    assert.ok(!setup.captureCharFrame().includes('Message:'), 'an unconfirmed mutation prevents creating a competing draft')
    act(() => setup.mockInput.pressKey('t'))
    await until('explicit same-request retry confirms', () => setup.captureCharFrame().includes('Remote action confirmed'))
    const checked = await fetch(`${machine.baseUrl}/fixture`, { headers: machines.machineHeaders(machine) })
    if (!checked.ok) throw new Error('Fixture ledger read failed')
    const confirmed = await checked.json()
    assert.equal(confirmed.snapshot.messages.filter((message: { body: string }) => message.body === 'One remote message').length, 1, 'rendered retry cannot duplicate the accepted remote effect')
  }
  act(() => setup.mockInput.pressEscape())
  await until('escape restores the local app', () => !setup.captureCharFrame().includes('REMOTE · render-box'))

  // Pairing scope changes are observed without restarting the local app.
  await control({ native: 'tool' })
  machines.writeMachines([{ ...machine, scope: 'read-only', credential: machine.readOnly }])
  act(() => setup.mockInput.pressEnter())
  await until('read-only remote inspection stays available', () => setup.captureCharFrame().includes('Read-only pairing'))
  act(() => setup.mockInput.pressKey('p'))
  await until('read-only native context can be inspected', () => setup.captureCharFrame().includes('NATIVE REQUEST'))
  const beforeReadOnly = (await control()).nativeActions.length
  act(() => setup.mockInput.pressEnter())
  await settle()
  act(() => setup.mockInput.pressKey('y'))
  await settle()
  assert.equal((await control()).nativeActions.length, beforeReadOnly, 'read-only native inspection cannot answer')
  act(() => setup.mockInput.pressEscape())
  await settle()
  act(() => setup.mockInput.pressKey('m'))
  await settle()
  assert.ok(!setup.captureCharFrame().includes('Message:'), 'read-only input cannot open a message draft')
  assert.ok(setup.captureCharFrame().includes('render-box transcript'))
  act(() => setup.mockInput.pressEscape())
  await settle()
  assert.equal(drafts.readComposerDraft('codex:local-reader'), 'Keep my local draft')
  console.log(`Remote coordinator rendered smoke passed (${width}x${height}: real-root remote selection, transcript, correlated reply, native approval/question confirmation, read-only input, escape and local draft preservation${width >= 70 ? ', lost-response journal and rendered retry' : ''})`)
  act(() => setup.renderer.destroy())
} catch (error) {
  child.kill('SIGTERM')
  console.error(error)
  process.exit(1)
} finally { child.kill('SIGTERM') }
process.exit(0)
