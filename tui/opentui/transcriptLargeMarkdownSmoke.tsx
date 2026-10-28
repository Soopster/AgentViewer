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
import { STRUCTURED_MARKDOWN_ROWS } from './markdownBlocks'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-reader-window-')))
const view = 'conversation'
const session: Session = {
  sessionId: 'reader-window', provider: 'codex', cwd: process.cwd(), summary: 'Reader window', lastModified: 1700000000000,
}
const rawMessages: SessionMessage[] = []
const threadedMessages: import('../../lib/threading').ThreadedMessage[] = []
const kind = process.env.STRUCTURED_MARKDOWN_KIND ?? 'paragraph'
const rowCount = Number(process.env.STRUCTURED_MARKDOWN_ROWS) || (kind === 'paragraph' ? 500 : 3000)
const prefix = kind === 'code' ? 'Code' : kind === 'list' ? 'Item' : kind === 'table' ? 'Cell' : 'Paragraph'
const label = (index: number) => `${prefix}_${String(index).padStart(5, '0')}`
const markdownContent = kind === 'code'
  ? `\`\`\`js\n/* A comment spanning every chunk:\n${Array.from({ length: rowCount }, (_, index) => label(index) + ' 界 😀').join('\n')}\n*/\nconst after = "syntax survives the comment";\n\`\`\``
  : kind === 'list'
    ? Array.from({ length: rowCount }, (_, index) => `- ${label(index)} with **bold** and \`code\`. This list item keeps its source marker.`).join('\n')
    : kind === 'table'
      ? `| Name | Description |\n| --- | --- |\n${Array.from({ length: rowCount }, (_, index) => `| ${label(index)} | **bold** value with Unicode 界 😀 |`).join('\n')}`
      : Array.from({ length: rowCount }, (_, index) => `${label(index)} with **bold** and \`code\`. This is a complete paragraph of a long assistant response.`).join('\n\n')
const card = {
  key: 'large-markdown', role: 'assistant' as const, provider: 'codex' as const,
  label: 'Large reply', category: 'conversation' as const, autoFold: false,
  compactSummary: 'Large diff', lines: [{ text: 'Large diff', tone: 'default' as const }],
  expandedLines: [{ text: 'Large diff', tone: 'default' as const }],
  searchText: 'Large diff', searchHaystackLower: 'large diff',
  markdownContent,
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
for (let attempt = 0; attempt < 20 && !setup.captureCharFrame().includes(label(0)); attempt++) await settle()
assert.ok(setup.captureCharFrame().includes(label(0)), setup.captureCharFrame())
const findVirtual = (node: { id: string; getChildren(): unknown[] }): boolean => node.id.startsWith('virtual-row:') || node.getChildren().some(child => findVirtual(child as Parameters<typeof findVirtual>[0]))
const baseline = process.env.STRUCTURED_MARKDOWN_PERF === '1'
const expectVirtual = kind === 'paragraph' || rowCount > STRUCTURED_MARKDOWN_ROWS
if (!baseline && expectVirtual) assert.ok(findVirtual(scroll.content), 'large Markdown must use block virtualization')
const countNodes = (node: { getChildren(): unknown[] }): number => 1 + node.getChildren().reduce<number>((sum, child) => sum + countNodes(child as Parameters<typeof countNodes>[0]), 0)
if (!baseline) assert.ok(countNodes(scroll.content) < 700, `large Markdown mounted ${countNodes(scroll.content)} native nodes at the top`)
await act(async () => { scroll.scrollTo(Math.floor(scroll.scrollHeight / 2)) })
await settle()
assert.ok(new RegExp(`${prefix}_\\d+`).test(setup.captureCharFrame()), setup.captureCharFrame())
assert.ok(scroll.scrollHeight > 500, 'retain the long document extent')
if (!baseline) assert.ok(countNodes(scroll.content) < 700, `large Markdown mounted ${countNodes(scroll.content)} native nodes in the middle`)
await act(async () => { scroll.scrollTo(1e9) })
for (let attempt = 0; attempt < 20 && !setup.captureCharFrame().includes(label(rowCount - 1)); attempt++) await settle()
assert.ok(setup.captureCharFrame().includes(label(rowCount - 1)), `last source row remains reachable:\n${setup.captureCharFrame()}`)
if (!baseline) assert.ok(countNodes(scroll.content) < 700, `large Markdown mounted ${countNodes(scroll.content)} native nodes at the tail`)
assert.ok(frameTimes.length > 0, 'renderer frames were actually sampled')
const sourceTextBytes = (node: { getChildren(): unknown[]; content?: string | { chunks?: Array<{ text: string }> } }): number => {
  const source = typeof node.content === 'string' ? node.content : node.content?.chunks?.map(chunk => chunk.text).join('') ?? ''
  return (source.includes(`${prefix}_`) ? Buffer.byteLength(source) : 0)
    + node.getChildren().reduce<number>((sum, child) => sum + sourceTextBytes(child as Parameters<typeof sourceTextBytes>[0]), 0)
}
const mountedCodeSourceBytes = kind === 'code' ? sourceTextBytes(scroll.content) : undefined
if (!baseline && kind === 'code' && expectVirtual) {
  assert.ok(mountedCodeSourceBytes! > 0, 'mounted code source was actually measured')
  assert.ok(mountedCodeSourceBytes! < 16_384, 'only viewport code slices own native text content')
}
console.log(JSON.stringify({ benchmark: 'large-transcript-markdown', kind, sourceRows: rowCount, sourceCharacters: markdownContent.length, nodes: countNodes(scroll.content), mountedCodeSourceBytes, frames: summarizeFrameTimes(frameTimes), rssBytes: process.memoryUsage.rss() }))
setup.renderer.destroy()
console.log('Large transcript Markdown passed: worker parsing, virtual blocks, top/middle content and full extent')
process.exit(0)
