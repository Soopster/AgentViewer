/** @jsxImportSource @opentui/react */
// Every built-in transcript view, painted cell for cell (characters, colours,
// attributes), against a golden recorded from the build before views became
// specs. The refactor that turned thirteen hard-coded views into ViewSpec
// presets must not change what any of them draws, and a frame is the only place
// a lost marker, band or fold shows.
//
// It is a refactor tool, not a chain smoke: goldens are ~130KB a view and
// change with any unrelated chrome. Record on the commit before a change to how
// views draw, then compare on the change, four processes at a time (more and
// the sidebar's load timing differs between runs):
//
//   VIEW_PARITY_DIR=<dir>         where goldens live (required)
//   VIEW_PARITY_VIEW=<view>       the view to render (one process per view)
//   VIEW_PARITY_RECORD=1          write the golden instead of comparing
import React from 'react'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildThreadedMessages } from '../../lib/threading'
import { formatTranscriptCards } from '../format'
import type { Session, SessionMessage } from '../../lib/types'
import { testRender, act } from './testRender'

if (!process.env.VIEW_PARITY_DIR) {
  console.error('VIEW_PARITY_DIR is required: record goldens on the base commit with VIEW_PARITY_RECORD=1, then compare.')
  process.exit(2)
}
const goldenDir = path.resolve(process.env.VIEW_PARITY_DIR)
const view = process.env.VIEW_PARITY_VIEW ?? 'conversation'
const record = process.env.VIEW_PARITY_RECORD === '1'
// A fixed basename: the spaces bar names the workspace after its directory.
const workdir = path.join(mkdtempSync(path.join(tmpdir(), 'agent-viewer-view-parity-')), 'parity')
mkdirSync(workdir)
process.chdir(workdir)

const session: Session = {
  sessionId: 'view-parity', provider: 'claude', cwd: '/srv/parity', summary: 'View parity', lastModified: 1_600_000_000_000,
}
let n = 0
const at = (minute: number) => `2020-09-13T12:${String(minute).padStart(2, '0')}:00.000Z`
const message = (type: 'user' | 'assistant', content: unknown, minute: number): SessionMessage => ({
  type, uuid: `parity-${n += 1}`, session_id: session.sessionId, parent_tool_use_id: null, timestamp: at(minute),
  message: { role: type, content } as SessionMessage['message'],
})
const rawMessages: SessionMessage[] = [
  message('user', 'Why does the pool **respawn** after a model change?', 0),
  message('assistant', [
    { type: 'thinking', thinking: 'The pool keys on cwd and effort. A model change is applied live.' },
    { type: 'text', text: 'It does not respawn for a model change.\n\n- `setModel` is applied live\n- effort between named levels is live too\n\nOnly **cwd** and thinking transitions respawn.' },
  ], 1),
  message('assistant', [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'grep -n respawn lib/claudePool.ts' } }], 2),
  message('user', [{ type: 'tool_result', tool_use_id: 'tool-1', content: '120: respawn on cwd change\n188: respawn on thinking off' }], 2),
  message('assistant', [{ type: 'tool_use', id: 'tool-2', name: 'Edit', input: { file_path: '/srv/parity/lib/claudePool.ts', old_string: 'const a = 1\n', new_string: 'const a = 2\n' } }], 3),
  message('user', [{ type: 'tool_result', tool_use_id: 'tool-2', content: 'The file has been updated.' }], 3),
  message('assistant', 'Changed the constant. The pool now keeps its entry across a model switch.', 4),
  message('user', 'Thanks. Run the smoke?', 5),
  message('assistant', [{ type: 'tool_use', id: 'tool-3', name: 'Read', input: { file_path: '/srv/parity/README.md' } }], 6),
  message('user', [{ type: 'tool_result', tool_use_id: 'tool-3', content: '# Parity\nA readme.' }], 6),
  message('assistant', 'The smoke passed.', 7),
]
const threadedMessages = buildThreadedMessages(rawMessages)
const transcriptCards = formatTranscriptCards(threadedMessages)
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
  readTuiProvider: async () => 'claude', readTuiTranscriptView: async () => view, writeTuiTranscriptView: async () => {},
  readTuiSessions: async () => [session], readTuiSessionDetail: async () => detail,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [], prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [], readTuiComposerOptions: async () => ({ agents: [], models: [] }),
  readTuiSessionReaderState: async () => null, writeTuiSessionReaderState: async () => {},
}))
const { default: App, IDLE_TICKER_PHRASES } = await import('./App')
const setup = await testRender(<App />, { width: 130, height: 44, kittyKeyboard: true })
const settle = async (ms = 250) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

type Cell = { text: string; fg: string; bg: string; attributes: number; width: number }
// A row that carries the animated idle ticker is masked: it moves on a timer.
const tickerRow = (row: string) => IDLE_TICKER_PHRASES.some((phrase) => row.includes(phrase))
const capture = () => {
  const chars = setup.captureCharFrame().split('\n')
  const spans = setup.captureSpans()
  const hex = (c: unknown) => {
    const value = c as { r: number; g: number; b: number; a: number } | null
    return value ? [value.r, value.g, value.b, value.a].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('') : '-'
  }
  return chars.map((row, y) => tickerRow(row) ? '<ticker>' : JSON.stringify(
    spans.lines[y]?.spans.map((span): Cell => ({ text: span.text, fg: hex(span.fg), bg: hex(span.bg), attributes: span.attributes ?? 0, width: span.width })) ?? [],
  ))
}

const frames: Record<string, string[]> = {}
try {
  await settle(2500)
  frames.browse = capture()
  act(() => { setup.mockInput.pressEnter() })
  await settle(800)
  frames.reader = capture()
  act(() => { setup.mockInput.pressKey('k') })
  await settle(400)
  act(() => { setup.mockInput.pressKey('e') })
  await settle(600)
  frames.toggled = capture()
} finally {
  await act(async () => setup.renderer.destroy())
}

const file = path.join(goldenDir, `${view}.json`)
if (record) {
  mkdirSync(goldenDir, { recursive: true })
  writeFileSync(file, JSON.stringify(frames, null, 1))
  console.log(`View parity golden recorded: ${view}`)
  process.exit(0)
}
if (!existsSync(file)) {
  console.error(`No golden for ${view} at ${file}`)
  process.exit(1)
}
const golden = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string[]>
const failures: string[] = []
for (const [name, rows] of Object.entries(golden)) {
  const now = frames[name] ?? []
  for (let y = 0; y < Math.max(rows.length, now.length); y += 1) {
    if (rows[y] === now[y]) continue
    const was = rows[y] === '<ticker>' || rows[y] === undefined ? [] : JSON.parse(rows[y]!) as Cell[]
    const is = now[y] === '<ticker>' || now[y] === undefined ? [] : JSON.parse(now[y]!) as Cell[]
    const at = was.findIndex((cell, i) => JSON.stringify(cell) !== JSON.stringify(is[i]))
    const index = at < 0 ? was.length : at
    failures.push(`${view}/${name} row ${y}: ${was.map((c) => c.text).join('')}\n  span ${index} was ${JSON.stringify(was[index])}\n  span ${index} now ${JSON.stringify(is[index])}`)
  }
}
if (failures.length) {
  console.error(failures.slice(0, 6).join('\n'))
  console.error(`${failures.length} rows differ`)
  process.exit(1)
}
console.log(`View parity passed: ${view}`)
process.exit(0)
