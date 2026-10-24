/** @jsxImportSource @opentui/react */
// Large Markdown uses worker parsing and viewport block rendering.
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
  key: 'large-markdown', role: 'assistant' as const, provider: 'codex' as const,
  label: 'Large reply', category: 'conversation' as const, autoFold: false,
  compactSummary: 'Large diff', lines: [{ text: 'Large diff', tone: 'default' as const }],
  expandedLines: [{ text: 'Large diff', tone: 'default' as const }],
  searchText: 'Large diff', searchHaystackLower: 'large diff',
  markdownContent: Array.from({ length: 500 }, (_, index) => `Paragraph_${String(index).padStart(5, '0')} with **bold** and \`code\`. This is a complete paragraph of a long assistant response.`).join('\n\n'),
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
for (let attempt = 0; attempt < 10 && !setup.captureCharFrame().includes('Paragraph_00000'); attempt++) await settle()
assert.ok(setup.captureCharFrame().includes('Paragraph_00000'), setup.captureCharFrame())
const findVirtual = (node: { id: string; getChildren(): unknown[] }): boolean => node.id.startsWith('virtual-row:') || node.getChildren().some(child => findVirtual(child as Parameters<typeof findVirtual>[0]))
assert.ok(findVirtual(scroll.content), 'large Markdown must use block virtualization')
await act(async () => { scroll.scrollTo(Math.floor(scroll.scrollHeight / 2)) })
await settle()
assert.ok(/Paragraph_\d+/.test(setup.captureCharFrame()), setup.captureCharFrame())
assert.ok(scroll.scrollHeight > 500, 'retain the long document extent')
setup.renderer.destroy()
console.log('Large transcript Markdown passed: worker parsing, virtual blocks, top/middle content and full extent')
process.exit(0)
