/** @jsxImportSource @opentui/react */
// The turn overview in the real app: the sub-agent strip's row, a sub-agent row's
// click, the turn outline and the "since you left" divider.
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildThreadedMessages } from '../../lib/threading'
import { formatTranscriptCards } from '../format'
import type { Session, SessionMessage } from '../../lib/types'
import { testRender, act } from './testRender'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-turn-overview-')))
const view = 'stream'
const session: Session = { sessionId: 'turn-overview', provider: 'codex', cwd: process.cwd(), summary: 'Turn overview', lastModified: 1700000000000 }
const row = (uuid: string, type: 'user' | 'assistant', content: unknown) => ({
  type, uuid, session_id: session.sessionId, parent_tool_use_id: null, message: { role: type, content },
}) as SessionMessage
const activity = (uuid: string, name: string, kind: 'started' | 'completed') => row(uuid, 'assistant', [
  { type: 'text', text: `⤷ ${name} ${kind}`, subagentActivity: { path: `/root/${name}`, threadId: `thread-${name}`, kind } },
])
const rawMessages: SessionMessage[] = [
  row('p1', 'user', 'FIRST PROMPT'), row('r1', 'assistant', 'first reply'),
  row('p2', 'user', 'SECOND PROMPT'),
  activity('a1', 'task_plugin', 'started'), activity('a2', 'bridge_plugin', 'started'), activity('a3', 'task_plugin', 'completed'),
  row('r2', 'assistant', 'second reply'),
]
const threadedMessages = buildThreadedMessages(rawMessages)
const transcriptCards = formatTranscriptCards(threadedMessages)
// As if the first turn had been read and the second arrived while away.
const { writeLastSeen, readLastSeen } = await import('../../lib/tuiLastSeen')
const { sessionKey } = await import('./app/sessionList')
writeLastSeen(sessionKey(session), { cardKey: 'r1', at: Date.now() })
const detail = { info: session, rawMessages, threadedMessages, transcriptCards,
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null }
const specifier = 'bun:test'
const { mock } = await import(specifier) as { mock: { module: (name: string, factory: () => unknown) => void } }
const client = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...client,
  readTuiSessionsAsync: async () => [session],
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
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [], prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [], readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  readTuiSessionReaderState: async () => null, writeTuiSessionReaderState: async () => {},
}))
const { default: App, readRootRenderCount } = await import('./App')
const setup = await testRender(<App />, { width: 140, height: 44, kittyKeyboard: true })

const { registerSubagentRowOpener } = await import('./app/windowCardActions')
const settle = async (ms = 250) => {
  const until = performance.now() + ms
  while (performance.now() < until) await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 8)) })
}
const frame = () => setup.captureCharFrame()
const node = (id: string) => setup.renderer.root.findDescendantById(id)
await settle(1800)
const opened: string[] = []
registerSubagentRowOpener((_parent, entry) => { opened.push(entry.threadId) })
const click = async (x: number, y: number) => { await act(async () => { await setup.mockMouse.click(x, y) }); await settle() }

assert(frame().includes('NEW SINCE YOU LEFT · 1 turn'), frame())
const lines = () => frame().split('\n')
const strip = node('subagent-strip')
assert(strip, 'no sub-agent strip')
assert.equal(strip.height, 1)
assert(lines()[strip.y]!.includes('✓ task_plugin') && lines()[strip.y]!.includes('· bridge_plugin'), lines()[strip.y])
const scroll = node('transcript-scroll')!
assert(strip.y < scroll.y, 'the strip overlaps the transcript')

const chip = node('subagent-strip:bridge_plugin')!
await click(chip.x + 2, chip.y)
assert.deepEqual(opened, ['thread-bridge_plugin'])
const rowAt = lines().findIndex((line, index) => index > scroll.y && line.includes('⤷ task_plugin completed'))
assert(rowAt > 0, frame())
assert.equal(lines().filter(line => line.includes('⤷ task_plugin')).length, 1, 'records of one agent were not merged')
await click(lines()[rowAt]!.indexOf('task_plugin completed') + 2, rowAt)
assert.deepEqual(opened, ['thread-bridge_plugin', 'thread-task_plugin'])

const { openSelectedWindowOutline } = await import('./app/windowCardActions')
await act(async () => { assert(openSelectedWindowOutline()) })
await settle()
assert(node('turn-outline'), 'the outline did not open')
assert(frame().includes('FIRST PROMPT') && frame().includes('esc close'), frame())
await act(async () => { setup.mockInput.pressKey('k') })
await settle()
await act(async () => { setup.mockInput.pressEnter() })
await settle()
assert(!node('turn-outline'), 'Enter left the outline open')
await act(async () => { openSelectedWindowOutline() })
await settle()
await act(async () => { setup.mockInput.pressEscape() })
await settle()
assert(!node('turn-outline'), 'Esc left the outline open')
assert(!frame().includes('Quit'), 'Esc reached the app behind the outline')

await act(async () => { setup.renderer.destroy() })
assert.equal(readLastSeen(sessionKey(session))?.cardKey, 'r2', 'leaving did not record how far was read')
console.log('turnOverviewAppSmoke: OK')
process.exit(0)
