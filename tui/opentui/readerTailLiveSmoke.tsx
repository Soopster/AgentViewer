/** @jsxImportSource @opentui/react */
// Regression for a bottomed-out viewport hiding three later messages.
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ScrollBoxRenderable } from '@opentui/core'
import { buildThreadedMessages } from '../../lib/threading'
import { formatTranscriptCards } from '../format'
import type { Session, SessionMessage } from '../../lib/types'
import { testRender, act } from './testRender'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-reader-window-')))
const view = 'scrollback'
const session: Session = {
  sessionId: 'reader-window', provider: 'codex', cwd: process.cwd(), summary: 'Reader window', lastModified: 1700000000000,
}
const source = [
 ...Array.from({ length: 20 }, (_, i) => `Earlier ${i}`),
 Array.from({ length: 1000 }, (_, i) => `Tall activity output row ${i}`).join('\n'),
 'NEWEST_ONE', 'NEWEST_TWO', 'NEWEST_THREE',
]
const buildDetail = () => {
 const rawMessages: SessionMessage[] = source.map((text, i) => ({
  type: 'assistant', uuid: `tail-live-${i}`, session_id: session.sessionId, parent_tool_use_id: null,
  message: { role: 'assistant', content: text },
 }))
 const threadedMessages = buildThreadedMessages(rawMessages)
 return { info: { ...session }, rawMessages, threadedMessages, transcriptCards: formatTranscriptCards(threadedMessages),
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null }
}
let detail = buildDetail()
const specifier = 'bun:test'
const { mock } = await import(specifier) as { mock: { module: (name: string, factory: () => unknown) => void } }
const client = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...client,
  readTuiSessionsAsync: async () => [session],
  readTuiSubagentSummariesAsync: async () => [],
  readTuiSessionDetailAsync: async () => detail,
  warmTranscriptAsync: async () => {},
}))
const metadata = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadata,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service,
  readTuiProvider: async () => 'codex', readTuiTranscriptView: async () => view,
  readTuiSessions: async () => [session], readTuiSessionDetail: async () => detail,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [{ provider: 'codex', sessionId: session.sessionId, pendingPermissions: [], pendingPrompts: [] }], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [], prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [], readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  readTuiSessionReaderState: async () => null, writeTuiSessionReaderState: async () => {},
}))
const { default: App } = await import('./App')
const setup = await testRender(<App />, { width: 140, height: 44, kittyKeyboard: true })

const settle = async (ms = 100) => {
 const until = Date.now() + ms
 while (Date.now() < until) await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 16)) })
}
const waitFor = async (label: string, condition: () => boolean) => {
 const until = Date.now() + 10_000
 while (Date.now() < until) { await settle(); if (condition()) return }
 assert.fail(`${label}\n${setup.captureCharFrame()}`)
}
const scroll = () => setup.renderer.root.findDescendantById('transcript-scroll') as ScrollBoxRenderable | undefined
await waitFor('newest three messages after a tall card', () => setup.captureCharFrame().includes('NEWEST_THREE'))
assert.ok(!/later messages?/.test(setup.captureCharFrame()), 'tail contains every newest card')
await act(async () => { setup.mockInput.pressTab() })
await settle(300)
source.push('LIVE_APPEND_ONE', 'LIVE_APPEND_TWO', 'LIVE_APPEND_THREE')
session.transcriptUpdatedAt = 1700000001000
detail = buildDetail()
await waitFor('live appends reach the viewport without scrolling', () => setup.captureCharFrame().includes('LIVE_APPEND_THREE'))
assert.ok(!/later messages?/.test(setup.captureCharFrame()))
await act(async () => { scroll()!.scrollTo(0) })
await settle(350)
const detachedTop = scroll()!.scrollTop
source.push('APPEND_WHILE_READING')
session.transcriptUpdatedAt = 1700000002000
detail = buildDetail()
await settle(3000)
assert.equal(scroll()!.scrollTop, detachedTop, 'new content does not yank a detached reader')
await act(async () => { setup.mockInput.pressKey('G') })
await waitFor('G returns to the actual latest message', () => setup.captureCharFrame().includes('APPEND_WHILE_READING'))
assert.ok(!/later messages?/.test(setup.captureCharFrame()))
setup.renderer.destroy()
console.log('Live reader tail passed: tall card plus three later messages, live appends, detached history and G to latest')
process.exit(0)
