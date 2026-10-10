/** @jsxImportSource @opentui/react */
import React, { act } from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ScrollBoxRenderable } from '@opentui/core'
import { buildThreadedMessages } from '../../lib/threading'
import { formatTranscriptCards } from '../format'
import type { Session, SessionMessage } from '../../lib/types'
import { testRender } from '@opentui/react/test-utils'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-tab-position-')))
const count = Number(process.env.TUI_TAB_POSITION_MESSAGES ?? 600)
const sessions: Session[] = ['a', 'b'].map((id, i) => ({
  sessionId: `tab-position-${id}`, provider: 'codex', cwd: process.cwd(),
  summary: `Position ${id}`, lastModified: 1700000000000 - i,
}))
const details = sessions.map((session) => {
  const rawMessages: SessionMessage[] = Array.from({ length: count }, (_, i) => ({
    type: i % 2 ? 'assistant' : 'user', uuid: `${session.sessionId}-${i}`,
    session_id: session.sessionId, parent_tool_use_id: null,
    message: { role: i % 2 ? 'assistant' : 'user', content: `Message ${i}\n${'A line of transcript text.\n'.repeat(6)}` },
  }))
  const threadedMessages = buildThreadedMessages(rawMessages)
  return { info: session, rawMessages, threadedMessages, transcriptCards: formatTranscriptCards(threadedMessages),
    transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null }
})
const detailFor = (session: Session) => details[sessions.findIndex((candidate) => candidate.sessionId === session.sessionId)]
const specifier = 'bun:test'
const { mock } = await import(specifier) as { mock: { module: (name: string, factory: () => unknown) => void } }
const client = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...client,
  readTuiSessionsAsync: async () => sessions,
  readTuiSessionDetailAsync: async (session: Session) => detailFor(session),
  warmTranscriptAsync: async () => {},
}))
const metadata = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadata,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service,
  readTuiProvider: async () => 'codex', readTuiTranscriptView: async () => 'conversation',
  readTuiSessions: async () => sessions, readTuiSessionDetail: async (session: Session) => detailFor(session),
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [], prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [], readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  // Deliberately unavailable durable state: returning to a tab must not rely
  // on its debounced write finishing, or replace its snapshot with stale disk.
  readTuiSessionReaderState: async () => null, writeTuiSessionReaderState: async () => {},
}))
const { default: App } = await import('./App')
const setup = await testRender(<App />, { width: 140, height: 44, kittyKeyboard: true })
const settle = async (ms = 160) => {
  const until = performance.now() + ms
  while (performance.now() < until) {
    await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 16)) })
  }
}
const key = async (name: string, ms = 160) => {
  act(() => name === 'tab' ? setup.mockInput.pressTab() : setup.mockInput.pressKey(name))
  await settle(ms)
}
const scroll = () => {
  const sb = setup.renderer.root.findDescendantById('transcript-scroll') as ScrollBoxRenderable | null
  assert.ok(sb, 'Transcript scrollbox is mounted')
  return sb
}
const location = (sessionIndex: number) => {
  const sb = scroll()
  for (const card of details[sessionIndex].transcriptCards) {
    const node = sb.content.findDescendantById(`card:${card.key}`)
    if (!node || node.height <= 0) continue
    const offset = node.y - sb.content.y - sb.scrollTop
    if (offset + node.height > 0) return { key: card.key, offset, height: node.height }
  }
  throw new Error(`No visible anchor for tab ${sessionIndex}:\n${setup.captureCharFrame()}`)
}
try {
  await settle(1500)
  await key('tab') // open A as a tab
  await key('g')
  await key('j')
  await key('tab') // sidebar
  await key('j', 700)
  await key('tab') // open B as a tab
  await key('g')
  await key('j')
  await key('j')
  const b = location(1)
  await key('ARROW_LEFT', 600)
  assert.ok(location(0).key.startsWith(sessions[0].sessionId), 'Returned to A')
  // Cursor movement followed by an immediate switch must survive the 150ms
  // persistence debounce. Also move the viewport independently of the cursor.
  await key('j', 25)
  const sb = scroll()
  sb.scrollTo(sb.scrollTop + 17)
  const a = location(0)
  await key('ARROW_RIGHT', 600)
  assert.deepEqual(location(1), b, 'B retains its exact visible card and row offset')
  await key('ARROW_LEFT', 600)
  assert.deepEqual(location(0), a, 'A retains a scrolled viewport independently of its cursor')
  await settle(350)
  assert.deepEqual(location(0), a, 'Delayed cursor/layout effects do not move the restored viewport')
  await key('ARROW_RIGHT', 20)
  await key('ARROW_LEFT', 600)
  assert.deepEqual(location(0), a, 'Switching back while another tab loads does not overwrite the snapshot')
  const viewport = scroll().viewport
  await act(async () => { await setup.mockMouse.scroll(viewport.x + 5, viewport.y + 3, 'down') })
  await settle(60)
  const wheeled = location(0)
  assert.notDeepEqual(wheeled, a, 'The real mouse wheel moved the viewport')
  await key('ARROW_RIGHT', 500)
  await key('ARROW_LEFT', 500)
  assert.deepEqual(location(0), wheeled, 'Mouse-wheel viewport survives switching tabs')
  await key('G', 250)
  const tail = location(0)
  await key('ARROW_RIGHT', 500)
  await key('ARROW_LEFT', 500)
  assert.deepEqual(location(0), tail, 'Tail-following tabs also restore at the tail')
  console.log(`Tab transcript position passed (${count} messages): per-tab anchors, row offsets, rapid switches, and tail follow`)
} finally {
  act(() => setup.renderer.destroy())
}
process.exit(0)
