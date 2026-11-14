/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Session } from '../../lib/types'
import { sessionIdentityKey } from './sessionIdentity'
import { testRender, act } from './testRender'

process.chdir(mkdtempSync(path.join(tmpdir(), 'provider-instance-window-')))
const sessions: Session[] = ['work', 'personal'].map((instance, index) => ({
  provider: 'codex', providerInstanceId: instance, providerDisplayName: instance,
  sessionId: 'same-native-id', cwd: process.cwd(), summary: `${instance} conversation`, lastModified: 1700000000000 - index,
}))
const detail = (session: Session) => {
  const text = session.providerInstanceId === 'work' ? 'WORK_ONLY_TRANSCRIPT' : 'PERSONAL_ONLY_TRANSCRIPT'
  return { info: session, rawMessages: [], threadedMessages: [], contextUsage: null,
    transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true,
    transcriptCards: [{ key: 'same-native-message-id', role: 'assistant' as const, provider: 'codex' as const,
      label: 'Assistant', category: 'conversation' as const, autoFold: false, compactSummary: text,
      lines: [{ text, tone: 'default' as const }], expandedLines: [{ text, tone: 'default' as const }], searchText: text, searchHaystackLower: text.toLowerCase() }],
  }
}
const specifier = 'bun:test'
const { mock } = await import(specifier) as { mock: { module(name: string, factory: () => unknown): void } }
const client = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...client,
  readTuiSessionsAsync: async () => sessions, readTuiSessionDetailAsync: async (session: Session) => detail(session),
  readTuiSubagentSummariesAsync: async () => [], warmTranscriptAsync: async () => {},
}))
const metadata = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadata, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service,
  readTuiProvider: async () => 'codex', readTuiTranscriptView: async () => 'conversation',
  readTuiSessions: async () => sessions, readTuiSessionDetail: async (session: Session) => detail(session),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }), listTuiRunningSessions: async () => [],
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }), prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [], readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  readTuiSessionReaderState: async () => null, writeTuiSessionReaderState: async () => {},
}))
const { default: App } = await import('./App')
const setup = await testRender(<App />, { width: 140, height: 44, kittyKeyboard: true })
const settle = async () => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 50)) }) }
const waitFor = async (text: string) => {
  for (let attempt = 0; attempt < 100; attempt++) { await settle(); if (setup.captureCharFrame().includes(text)) return }
  assert.fail(`${text} did not become visible:\n${setup.captureCharFrame()}`)
}
try {
  await waitFor('WORK_ONLY_TRANSCRIPT')
  for (const session of [sessions[1]!, sessions[0]!, sessions[1]!]) {
    const row = setup.renderer.root.findDescendantById(`sidebar:session:${sessionIdentityKey(session)}`)
    assert.ok(row, 'both equal-ID instances retain independent sidebar rows')
    await act(async () => { await setup.mockMouse.click(row.x + 2, row.y) })
    const expected = session.providerInstanceId === 'work' ? 'WORK_ONLY_TRANSCRIPT' : 'PERSONAL_ONLY_TRANSCRIPT'
    await waitFor(expected)
    const other = session.providerInstanceId === 'work' ? 'PERSONAL_ONLY_TRANSCRIPT' : 'WORK_ONLY_TRANSCRIPT'
    assert.ok(!setup.captureCharFrame().includes(other), 'switching instances must not show the sibling transcript')
  }
} finally { act(() => setup.renderer.destroy()) }
console.log('Provider instance windows passed: equal session/message IDs, independent sidebar rows and repeated visible switching')
process.exit(0)
