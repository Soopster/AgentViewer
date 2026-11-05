/** @jsxImportSource @opentui/react */
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { testRender, act } from './testRender'
import type { Renderable } from '@opentui/core'
import type { Session, SessionMessage } from '../../lib/types'
import type { TuiDensity } from '../theme'
import { stripToolCallBlocks } from '../../lib/threading'
import { normalizeCodexStreamThreadedMessage } from '../../lib/codexMapper'
import { formatTranscriptCards } from '../format'

process.chdir(mkdtempSync(path.join(tmpdir(), 'codex-async-question-')))
const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}
const session: Session = {
  sessionId: 'codex-async', provider: 'codex', summary: 'Codex async smoke',
  lastModified: 1_700_000_000_000, transcriptUpdatedAt: 1_700_000_000_000,
}
let savedToolVisibility = false
const readDetail = async (_session: Session, density: TuiDensity, showToolCalls: boolean) => {
  const rawMessages: SessionMessage[] = []
  const threadedMessages = [normalizeCodexStreamThreadedMessage({
    type: 'codex_item_completed', threadId: session.sessionId, turnId: 'turn',
    item: { type: 'agentMessage', id: 'question', text: 'Please choose.', phase: 'final_answer',
      memoryCitation: null, delivery: 'async', questions: [{ title: 'Which layout?', options: ['Compact', 'Spacious'] }] },
  })!]
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
  ...service, runTuiSessionAction: async (_session: unknown, body: unknown) => { throw new Error(`Async questions must not send approval RPCs: ${JSON.stringify(body)}`) }, readTuiSessions: async () => [session],
  readTuiTranscriptView: async () => 'scrollback',
  readTuiShowToolCalls: async () => savedToolVisibility,
  writeTuiShowToolCalls: async (visible: boolean) => { savedToolVisibility = visible },
  readTuiRuntimeActivity: async () => ({
    running: [],
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
  assert.match(setup.captureCharFrame(), /Which layout/)
  assert.match(setup.captureCharFrame(), /Spacious/)
  assert.match(setup.captureCharFrame(), /TOOLS HIDDEN/)
  const card = setup.renderer.root.findDescendantById('card:turn:question')
  assert.ok(card, setup.captureCharFrame())
  await act(async () => { await setup.mockMouse.click(card.x + 2, card.y + 1) })
  await settle(300)
  assert.match(setup.captureCharFrame(), /CODEX asks/)
  act(() => { setup.mockInput.pressKey('1') })
  await settle(100)
  act(() => { setup.mockInput.pressEnter() })
  await settle(300)
  const frame = setup.captureCharFrame()
  assert.ok(!frame.includes('CODEX asks'), frame)
  assert.match(frame, /Which layout/)
  assert.match(frame, /Compact/)
  // The textarea, rather than just the question card, must contain the answer.
  const textareas: string[] = []
  const visit = (node: Renderable) => {
    if ('plainText' in node && typeof node.plainText === 'string') textareas.push(node.plainText)
    for (const child of node.getChildren()) visit(child)
  }
  visit(setup.renderer.root)
  assert.ok(textareas.some(text => text.includes('Which layout?\nCompact')), frame)
  console.log('OpenTUI async questions remain visible with tools hidden, open picker, and fill composer without approval RPCs')
} finally {
  act(() => { setup.renderer.destroy() })
}
process.exit(0)
