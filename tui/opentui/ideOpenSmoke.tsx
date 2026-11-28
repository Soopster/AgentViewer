/** @jsxImportSource @opentui/react */
// Open in IDE through the real App: with an editor chosen, clicking a transcript
// file target hands it to that editor at the line and does NOT open the built-in
// editor; when the launch fails, the built-in editor opens instead.
//   bun tui/opentui/ideOpenSmoke.tsx
import { testRender, act } from './testRender'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-ide-smoke-'))
process.chdir(CWD)
import { mkdirSync, writeFileSync } from 'node:fs'
mkdirSync(path.join(CWD, '.agent-viewer-data'), { recursive: true })
writeFileSync(path.join(CWD, '.agent-viewer-data', 'tui.json'), JSON.stringify({ ide: 'cursor' }))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION = {
  sessionId: 'link-smoke-session',
  provider: 'claude' as const,
  cwd: CWD,
  summary: 'Link smoke',
  firstPrompt: 'Link smoke',
  lastModified: 1_700_000_000_000,
}

const URL_TEXT = 'https://example.com/docs'
const PROSE = `See ${URL_TEXT} and lib/permissions.ts:39 plus and/or.`

const card = (key: string, text: string): TuiTranscriptCard => ({
  key,
  role: 'assistant',
  provider: 'claude',
  label: 'Assistant',
  category: 'conversation',
  autoFold: false,
  compactSummary: text,
  lines: [{ text, tone: 'default' }],
  expandedLines: [{ text, tone: 'default' }],
  searchText: text,
  searchHaystackLower: text.toLowerCase(),
})

const LINKS = card('link-card', PROSE)

const DETAIL = {
  info: { sessionId: SESSION.sessionId, provider: 'claude' as const, cwd: CWD },
  rawMessages: [],
  threadedMessages: [],
  transcriptCards: [LINKS],
  transcriptCardsDensity: 'balanced' as const,
  transcriptCardsShowToolCalls: true,
  contextUsage: null,
}

const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => [SESSION],
  readTuiSessionDetailAsync: async () => DETAIL,
}))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({
  ...metadataClient,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => [SESSION],
  readTuiSessionDetail: async () => DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }),
  listTuiRunningSessions: async () => [],
  prewarmTuiSession: async () => {},
}))

// The file target opens the project editor, and the editor immediately scans the
// project and spawns language servers — none of which this is testing. Stub the
// popover with a marker that records what it was handed.
let editorOpenedWith: { path: string | null; line: number | null } | null = null
const editorModule = await import('../../plugins/editor/tui/EditorPopover')
mock.module('../../plugins/editor/tui/EditorPopover', () => ({
  ...editorModule,
  EditorPopover: (props: { initialPath?: string | null; initialLine?: number | null }) => {
    editorOpenedWith = { path: props.initialPath ?? null, line: props.initialLine ?? null }
    return <text>EDITOR-STUB</text>
  },
}))

// The chosen editor: record what it is asked to open instead of launching it.
const ideOpened: { path: string; line: number | null; ide?: string }[] = []
let failLaunch = false
mock.module('../../lib/ide/service', () => ({
  nativeIde: {
    read: async () => ({ detected: [{ id: 'cursor', label: 'Cursor' }], preference: 'cursor', editor: null }),
    setPreference: async () => { throw new Error('unused') },
    open: async (input: { path: string; line: number | null; ide?: string }) => {
      ideOpened.push({ path: input.path, line: input.line, ide: input.ide })
      if (failLaunch) throw new Error('Cursor did not start')
      return { label: 'Cursor' }
    },
  },
}))

// Opening a URL must not actually launch a browser from a test.
let openedUrl: string | null = null
const browser = await import('./terminalBrowser')
mock.module('./terminalBrowser', () => ({
  ...browser,
  openExternalUrl: async (url: string) => { openedUrl = url },
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 150, height: 40, kittyKeyboard: true })
const settle = async (ms = 150) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

type LinkRenderer = { getLinkAt(x: number, y: number): string | null }
const linkRenderer = setup.renderer as unknown as LinkRenderer

const fail = (message: string): never => {
  throw new Error(`${message}\n${setup.captureCharFrame()}`)
}

// Find the row the prose landed on and the column a given substring starts at.
// Deriving both from the painted frame rather than from layout constants is what
// keeps this test honest about where the link actually is.
const locate = (needle: string): { x: number; y: number } => {
  const lines = setup.captureCharFrame().split('\n')
  for (let y = 0; y < lines.length; y += 1) {
    const x = lines[y]!.indexOf(needle)
    if (x >= 0) return { x, y }
  }
  return fail(`could not find ${JSON.stringify(needle)} in the frame`)
}

const click = async (x: number, y: number) => {
  await act(async () => { await setup.mockMouse.click(x, y) })
  await settle(120)
}

try {
  await settle(2500)
  act(() => { setup.mockInput.pressEnter() })
  await settle(700)
  const pathHit = locate('lib/permissions.ts:39')

  // ── 1. Cursor chosen: the click goes to Cursor at the line, not the built-in editor
  await click(pathHit.x + 2, pathHit.y)
  await settle(300)
  if (ideOpened.length !== 1) fail(`the chosen editor was asked ${ideOpened.length} times`)
  if (ideOpened[0]!.path !== `${CWD}/lib/permissions.ts` || ideOpened[0]!.line !== 39 || ideOpened[0]!.ide !== 'cursor') fail(`opened ${JSON.stringify(ideOpened[0])}`)
  if (editorOpenedWith !== null) fail('the built-in editor opened as well')
  if (!setup.captureCharFrame().includes('Opened lib/permissions.ts:39 in Cursor')) fail('no notice said where the file opened')

  // ── 2. a failed launch falls back to the built-in editor, at the same line
  failLaunch = true
  await click(pathHit.x + 2, pathHit.y)
  await settle(300)
  if (ideOpened.length !== 2) fail('the second click did not reach the chosen editor')
  if (!editorOpenedWith) fail('a failed launch did not fall back to the built-in editor')
  if (editorOpenedWith!.path !== `${CWD}/lib/permissions.ts` || editorOpenedWith!.line !== 39) fail(`fell back to ${JSON.stringify(editorOpenedWith)}`)

  console.log('Open in IDE smoke passed (chosen editor at the line, no built-in editor, notice, fallback on failure)')
} finally {
  act(() => { setup.renderer.destroy() })
}
