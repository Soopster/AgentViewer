/** @jsxImportSource @opentui/react */
// Large transcript diffs preserve full extent while bounding native nodes.
import React from 'react'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ScrollBoxRenderable } from '@opentui/core'
import type { Session, SessionMessage } from '../../lib/types'
import { testRender, act } from './testRender'
import { summarizeFrameTimes } from './performanceBudget'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-reader-window-')))
const view = 'conversation'
const session: Session = {
  sessionId: 'reader-window', provider: 'codex', cwd: process.cwd(), summary: 'Reader window', lastModified: 1700000000000,
}
const rawMessages: SessionMessage[] = []
const threadedMessages: import('../../lib/threading').ThreadedMessage[] = []
const card = {
  key: 'large-diff', role: 'assistant' as const, provider: 'codex' as const,
  label: 'large.ts', category: 'diff' as const, autoFold: false,
  compactSummary: 'Large diff', lines: [{ text: 'Large diff', tone: 'default' as const }],
  expandedLines: [{ text: 'Large diff', tone: 'default' as const }],
  searchText: 'Large diff', searchHaystackLower: 'large diff',
  editDiff: `diff --git a/large.ts b/large.ts\n--- a/large.ts\n+++ b/large.ts\n@@ -1,1 +1,10000 @@\n-before\n${Array.from({ length: 10000 }, (_, index) => `+added_${String(index).padStart(5, '0')}`).join('\n')}\n`,
}
const transcriptCards = [card]
const detail = { info: session, rawMessages, threadedMessages, transcriptCards,
  transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null }
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
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [], prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [], readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  readTuiSessionReaderState: async () => null, writeTuiSessionReaderState: async () => {},
}))
const { default: App } = await import('./App')
const setup = await testRender(<App />, { width: 140, height: 44, kittyKeyboard: true })

const frameTimes: number[] = []
const driver = setup.renderer as unknown as { loop(): Promise<void>; frameId: number }
const loop = driver.loop.bind(setup.renderer)
driver.loop = async () => {
 const before = driver.frameId
 const start = performance.now()
 await loop()
 if (before !== driver.frameId) frameTimes.push(performance.now() - start)
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, 16)) })
}
await settle()
const scroll = setup.renderer.root.findDescendantById('transcript-scroll') as ScrollBoxRenderable
assert.ok(scroll)
await act(async () => { scroll.scrollTo(0) })
await settle()
assert.ok(setup.captureCharFrame().includes('added_00000'), setup.captureCharFrame())
const countNodes = (node: { getChildren(): unknown[] }): number => 1 + node.getChildren().reduce<number>((sum, child) => sum + countNodes(child as Parameters<typeof countNodes>[0]), 0)
if (process.env.LARGE_DIFF_PERF !== '1') assert.ok(countNodes(scroll.content) < 700, `large diff mounted ${countNodes(scroll.content)} native nodes`)
await act(async () => { scroll.scrollTo(5000) })
await settle()
assert.ok(/added_0(?:49|50)\d{2}/.test(setup.captureCharFrame()), setup.captureCharFrame())
if (process.env.LARGE_DIFF_PERF !== '1') assert.ok(countNodes(scroll.content) < 700)
assert.ok(scroll.scrollHeight >= 10_000, 'full diff extent remains scrollable')
assert.ok(frameTimes.length > 0, 'renderer frames were actually sampled')
console.log(JSON.stringify({ benchmark: 'large-transcript-diff', nodes: countNodes(scroll.content), frames: summarizeFrameTimes(frameTimes), rssBytes: process.memoryUsage.rss() }))
setup.renderer.destroy()
console.log('Large transcript diff passed: 10k lines, bounded native nodes, top/middle rows and full scroll extent')
process.exit(0)
