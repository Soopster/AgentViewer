/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { toV1Question } from '../../lib/opencode2Mapping'
import { testRender, act } from './testRender'

process.chdir(mkdtempSync(path.join(tmpdir(), 'opencode-form-picker-')))
const specifier = 'bun:test'
const { mock } = await import(specifier) as { mock: { module(name: string, factory: () => unknown): void } }
const session = { sessionId: 'form-session', provider: 'opencode' as const, cwd: process.cwd(), summary: 'Form picker', lastModified: 1 }
const payload = { type: 'opencode_event', event: { type: 'question.asked', properties: toV1Question({
  id: 'form', sessionID: session.sessionId, title: 'Settings', fields: [
    { key: 'count', title: 'Count', type: 'integer', minimum: 1, maximum: 10, default: 3, required: true },
    { key: 'enabled', title: 'Enabled', type: 'boolean', default: false },
    { key: 'browser', title: 'Sign in', type: 'external', url: 'https://example.com/form' },
  ],
}) } }
const single = process.argv.includes('--single')
if (single) payload.event.properties.questions = payload.event.properties.questions.slice(0, 1)
const running = [{ ...session, pendingPrompts: [], pendingPermissions: [payload] }]
const detail = { info: null, rawMessages: [], threadedMessages: [], contextUsage: null }
const worker = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...worker,
  readTuiSessionsAsync: async () => [session], readTuiSessionDetailAsync: async () => detail,
  readTuiComposerAffordancesAsync: async () => ({ commands: [], options: { agents: [], permissionModes: [] } }),
  warmTranscriptAsync: async () => {},
}))
const metadata = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadata, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const opened: string[] = []
const browser = await import('./terminalBrowser')
mock.module('./terminalBrowser', () => ({ ...browser, openExternalUrl: async (url: string) => { opened.push(url); return true } }))
let submitted: Record<string, unknown> | undefined
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service,
  readTuiProvider: async () => 'opencode', readTuiTranscriptView: async () => 'agents',
  readTuiSessions: async () => [session], readTuiSessionDetail: async () => detail,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiComposerOptions: async () => ({ agents: [], permissionModes: [] }),
  readTuiSlashCommands: async () => [], prewarmTuiSession: async () => {},
  listTuiRunningSessions: async () => running,
  readTuiRuntimeActivity: async () => ({ running, waiting: [], attention: [] }),
  runTuiSessionAction: async (_target: unknown, body: Record<string, unknown>) => { submitted = body; return { ok: true } },
}))
const { default: App } = await import('./App')
const setup = await testRender(<App />, { width: 140, height: 48, kittyKeyboard: true })
const settle = async (ms = 100) => act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, ms)) })
const key = async (value: string) => { act(() => setup.mockInput.pressKey(value)); await settle() }
try {
  await settle(2500)
  const frame = setup.captureCharFrame()
  assert.ok(frame.includes('Whole number, minimum 1, maximum 10'), frame)
  assert.ok(frame.includes('Other: 3'), frame)
  if (!single) {
    assert.ok(frame.includes('● [2] No'), frame)
    assert.ok(frame.includes('o open form in browser: https://example.com/form'), frame)
    act(() => setup.mockInput.pressArrow('right')); await settle()
    act(() => setup.mockInput.pressArrow('right')); await settle()
    await key('o')
    assert.deepEqual(opened, ['https://example.com/form'])
  }
  act(() => setup.mockInput.pressEnter()); await settle()
  assert.equal(submitted?.action, 'respondQuestion')
  assert.deepEqual(submitted?.answers, single ? { 0: ['3'] } : { 0: ['3'], 1: ['No'] })
  console.log(`OpenCode form picker smoke passed (${single ? 'single numeric field' : 'multiple fields and external link'}): defaults, numeric hints, keyboard submission`)
} finally {
  act(() => setup.renderer.destroy())
}
process.exit(0)
