/** @jsxImportSource @opentui/react */
// Clicking a URL or a file path in the transcript (OpenTUI 0.5.11 getLinkAt).
//
// Everything about this feature is invisible to a type-checker and almost
// invisible in a frame. `renderer.getLinkAt(x, y)` reads a link id out of the
// PAINTED cell attributes, so a target is clickable only if the renderer emitted
// an `<a href>` for it — a styled `<span>` carrying identical text renders
// byte-identically and is completely inert. The char frame cannot tell the two
// apart, so this asserts on the link ids the renderer reports per cell.
//
// The three things that can silently break:
//   1. the wrong element (span instead of `a`) — text looks right, nothing clicks
//   2. the wrong columns — the link is painted, but offset from its text
//   3. the drag guard — selecting a line that starts on a path follows it instead
//
// Ordering matters here and is not cosmetic: the editor covers the transcript, so
// the file-path click has to come last or every later click lands on the editor
// and the negative assertions pass against nothing.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TuiTranscriptCard } from '../format'

const CWD = mkdtempSync(path.join(tmpdir(), 'agent-viewer-link-smoke-'))
process.chdir(CWD)

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
const editorModule = await import('./EditorPopover')
mock.module('./EditorPopover', () => ({
  ...editorModule,
  EditorPopover: (props: { initialPath?: string | null; initialLine?: number | null }) => {
    editorOpenedWith = { path: props.initialPath ?? null, line: props.initialLine ?? null }
    return <text>EDITOR-STUB</text>
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
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
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

  if (process.env.DUMP_FRAME) console.log(setup.captureCharFrame())
  if (!setup.captureCharFrame().includes(URL_TEXT)) fail('transcript did not render the prose line')

  // ── 1. the URL's own cells carry the link, and its neighbours do not ──────
  // An `<a>` whose span is off by a column still looks perfect on screen, so the
  // boundaries are asserted on both sides.
  const url = locate(URL_TEXT)
  if (linkRenderer.getLinkAt(url.x, url.y) !== URL_TEXT) {
    fail(`URL cell ${url.x},${url.y} reported ${JSON.stringify(linkRenderer.getLinkAt(url.x, url.y))}`)
  }
  if (linkRenderer.getLinkAt(url.x + URL_TEXT.length - 1, url.y) !== URL_TEXT) {
    fail('last cell of the URL is not part of the link')
  }
  if (linkRenderer.getLinkAt(url.x - 1, url.y) !== null) fail('the space before the URL is part of the link')
  if (linkRenderer.getLinkAt(url.x + URL_TEXT.length, url.y) !== null) fail('the space after the URL is part of the link')

  // ── 2. a path:line becomes a file target carrying the line ───────────────
  const pathHit = locate('lib/permissions.ts:39')
  const fileUrl = linkRenderer.getLinkAt(pathHit.x, pathHit.y)
  if (fileUrl !== `file://${CWD}/lib/permissions.ts#L39`) {
    fail(`path cell reported ${JSON.stringify(fileUrl)}, expected a file:// target with #L39`)
  }

  // ── 3. prose with a slash is NOT a link ──────────────────────────────────
  // The whole reason the detectors are conservative. `and/or` sits on the same
  // rendered line, so a tokenizer that linkified it would be caught here even
  // though the line looks identical either way.
  const prose = locate('and/or')
  if (linkRenderer.getLinkAt(prose.x, prose.y) !== null) {
    fail(`"and/or" was painted as a link (${JSON.stringify(linkRenderer.getLinkAt(prose.x, prose.y))})`)
  }

  // ── 4. clicking the URL opens it externally ──────────────────────────────
  await click(url.x + 2, url.y)
  if (openedUrl !== URL_TEXT) fail(`clicking the URL opened ${JSON.stringify(openedUrl)}`)

  // ── 5. a drag that STARTS on a link must not follow it ───────────────────
  // Selecting a line that happens to begin on a path is a far more common intent
  // than following it, and this is the guard that makes both possible. Press on
  // the link, release further along it: nothing should open.
  openedUrl = null
  await act(async () => { await setup.mockMouse.drag(url.x + 2, url.y, url.x + 10, url.y) })
  await settle(120)
  if (openedUrl !== null || editorOpenedWith !== null) {
    fail('a drag beginning on a link followed the link instead of selecting text')
  }

  // ── 6. and a click on ordinary text opens nothing ────────────────────────
  await click(prose.x, prose.y)
  if (openedUrl !== null || editorOpenedWith !== null) fail('clicking plain prose opened something')

  // ── 7. clicking the path opens the editor at that line ───────────────────
  // LAST, deliberately: the editor covers the transcript, so any check after
  // this one would be clicking the editor instead. Ordered earlier, the two
  // negative assertions above silently passed against a covered transcript and
  // kept passing with the drag guard deleted.
  await click(pathHit.x + 2, pathHit.y)
  if (!editorOpenedWith) fail('clicking a file path did not open the editor')
  if (editorOpenedWith!.path !== `${CWD}/lib/permissions.ts`) {
    fail(`editor opened ${JSON.stringify(editorOpenedWith!.path)}`)
  }
  // 1-based on the wire, because that is how the transcript wrote it.
  if (editorOpenedWith!.line !== 39) fail(`editor opened at line ${editorOpenedWith!.line}, expected 39`)
  if (openedUrl !== null) fail('a file path was also handed to the external opener')

  console.log('Transcript link smoke passed (link cells, boundaries, path:line, prose, click, drag guard)')
} finally {
  act(() => { setup.renderer.destroy() })
}
