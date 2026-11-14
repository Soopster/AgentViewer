/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testRender, act } from './testRender'
import type { Session, SessionMessage } from '../../lib/types'
import type { TuiDensity } from '../theme'
import { buildThreadedMessages, stripToolCallBlocks } from '../../lib/threading'
import { formatTranscriptCards } from '../format'

process.chdir(mkdtempSync(path.join(tmpdir(), 'codex-transcript-refresh-')))
const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}
let session: Session = {
  sessionId: 'codex-refresh', provider: 'codex', summary: 'Codex refresh smoke',
  lastModified: 1_700_000_000_000, transcriptUpdatedAt: 1_700_000_000_000,
}
let text = 'Original snapshot'
let reads = 0
let running = false
let savedToolVisibility = false
const readDetail = async (_session: Session, density: TuiDensity, showToolCalls: boolean) => {
  reads++
  const rawMessages: SessionMessage[] = [{
    type: 'assistant', uuid: 'reply', session_id: session.sessionId, provider: 'codex', parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  }, {
    type: 'assistant', uuid: 'file-change', session_id: session.sessionId, provider: 'codex', parent_tool_use_id: null,
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'edit-file', name: 'FileChange', input: {
      status: 'completed', changes: [{ path: 'restored-file-activity.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old\n+new' }],
    } }] },
  }, {
    type: 'user', uuid: 'file-change-result', session_id: session.sessionId, provider: 'codex', parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'edit-file', content: 'Applied 1 file change' }] },
  }]
  const threadedMessages = buildThreadedMessages(rawMessages)
  return {
    info: null, rawMessages, threadedMessages, contextUsage: null,
    transcriptCards: formatTranscriptCards(showToolCalls ? threadedMessages : stripToolCallBlocks(threadedMessages), density),
    transcriptCardsDensity: density, transcriptCardsShowToolCalls: showToolCalls,
  }
}
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient, readTuiSessionsAsync: async () => [session], readTuiSessionDetailAsync: readDetail,
}))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({
  ...metadataClient, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service, readTuiSessions: async () => [session],
  readTuiTranscriptView: async () => 'scrollback',
  readTuiShowToolCalls: async () => savedToolVisibility,
  writeTuiShowToolCalls: async (visible: boolean) => { savedToolVisibility = visible },
  readTuiRuntimeActivity: async () => ({
    running: running ? [{ sessionId: session.sessionId, provider: 'codex', pendingPermissions: [], pendingPrompts: [] }] : [],
    waiting: [], attention: [],
  }),
  listTuiRunningSessions: async () => [], prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [], readTuiComposerOptions: async () => ({ agents: [], models: [] }),
}))
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
async function settle(ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end) await act(async () => {
    await setup.flush()
    await new Promise(resolve => setTimeout(resolve, 20))
  })
}
try {
  await settle(2500)
  assert.ok(setup.captureCharFrame().includes('Original snapshot'), setup.captureCharFrame())
  assert.ok(setup.captureCharFrame().includes('TOOLS HIDDEN'), setup.captureCharFrame())
  assert.ok(!setup.captureCharFrame().includes('restored-file-activity.ts'))
  const showTools = setup.renderer.root.findDescendantById('show-tool-activity')
  assert.ok(showTools, 'hidden activity must have a visible show control')
  await act(async () => { await setup.mockMouse.click(showTools.x + 2, showTools.y) })
  await settle(500)
  assert.equal(savedToolVisibility, true, 'show action must persist tool visibility')
  assert.ok(!setup.captureCharFrame().includes('TOOLS HIDDEN'))
  assert.ok(setup.captureCharFrame().includes('restored-file-activity.ts'), setup.captureCharFrame())
  act(() => { setup.mockInput.pressKey('X') })
  await settle(300)
  assert.equal(savedToolVisibility, false)
  assert.ok(setup.captureCharFrame().includes('TOOLS HIDDEN'))
  assert.ok(!setup.captureCharFrame().includes('restored-file-activity.ts'))
  const restoreTools = setup.renderer.root.findDescendantById('show-tool-activity')
  assert.ok(restoreTools)
  await act(async () => { await setup.mockMouse.click(restoreTools.x + 2, restoreTools.y) })
  await settle(300)
  assert.equal(savedToolVisibility, true)
  assert.ok(setup.captureCharFrame().includes('restored-file-activity.ts'))
  running = true
  text = 'Live Codex reply while update time is unchanged'
  await settle(4500)
  assert.ok(setup.captureCharFrame().includes(text), setup.captureCharFrame())
  assert.ok(setup.captureCharFrame().split('\n').some(row => row.includes('Codex refresh') && row.includes('now')), `running sidebar session must show now:\n${setup.captureCharFrame()}`)
  running = false
  const before = reads
  // A completed reply changes the transcript while turn-start recency stays
  // fixed. Keep the same message UUID/count, as an in-place streaming update.
  text = 'Completed Codex reply is visible'
  session = { ...session, transcriptUpdatedAt: 1_700_000_100_000 }
  await settle(7500)
  assert.ok(reads > before, 'new provider update must invalidate the cached transcript')
  assert.ok(setup.captureCharFrame().includes(text), setup.captureCharFrame())
  assert.equal(session.lastModified, 1_700_000_000_000, 'displayed activity must stay unchanged')
  console.log('Codex completed transcript refresh smoke passed')
  process.exit(0)
} catch (error) {
  console.error(error)
  process.exit(1)
}
