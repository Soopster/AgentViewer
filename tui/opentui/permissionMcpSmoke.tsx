/** @jsxImportSource @opentui/react */
// MCP server provenance on the TUI permission card (Claude SDK 0.3.274).
//
// An `mcp__*` ask names which server serves the tool and where that server was
// configured, and the row is only worth anything if it is actually drawn — the
// card renders identically without it. This asserts the label and that the
// options and reason rows survive beside it. It does NOT pin the height plan's
// extra row: at this terminal size the plan has slack, and dropping the
// reservation was checked to still pass.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-permission-mcp-smoke-')))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const SESSION_ID = 'permission-mcp-session'
const SESSION = {
  sessionId: SESSION_ID,
  provider: 'claude' as const,
  cwd: process.cwd(),
  summary: 'Permission MCP smoke',
  firstPrompt: 'Permission MCP smoke',
  lastModified: 1_700_000_000_000,
}

const TITLE = 'Claude wants to create an issue'
const RUNNING = [{
  sessionId: SESSION_ID,
  provider: 'claude' as const,
  pendingPrompts: [{
    requestId: 'permission-mcp-request',
    sessionId: SESSION_ID,
    toolName: 'mcp__github__create_issue',
    title: TITLE,
    input: { title: 'Broken build' },
    decisionReason: 'The tool is not in any allow rule',
    mcpServer: { name: 'github', source: 'project' },
  }],
  pendingPermissions: [],
}]

const EMPTY_DETAIL = { info: null, rawMessages: [], threadedMessages: [], contextUsage: null }

const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => [SESSION],
  readTuiSessionDetailAsync: async () => EMPTY_DETAIL,
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
  readTuiSessionDetail: async () => EMPTY_DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  listTuiRunningSessions: async () => RUNNING,
  readTuiRuntimeActivity: async () => ({ running: RUNNING, waiting: [], attention: [] }),
}))

const { default: OpenTuiApp } = await import('./App')

const setup = await testRender(<OpenTuiApp />, { width: 120, height: 44, kittyKeyboard: true })
const settle = async (ms = 400) => {
  await act(async () => {
    await setup.flush()
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
const fail = (message: string): never => {
  throw new Error(`${message}\n${setup.captureCharFrame()}`)
}
const shows = (needle: string) => setup.captureCharFrame().includes(needle)

try {
  await settle(3000)
  if (!shows(TITLE)) fail('the permission card never rendered')

  if (!shows('MCP · github · configured · project')) fail('the MCP provenance row was not drawn')

  {
    const lines = setup.captureCharFrame().split('\n')
    const optionsRow = lines.find((line) => line.includes('Reject'))
    if (!optionsRow) fail('the options row vanished — the provenance row was not reserved in the height plan')
    if (optionsRow!.includes(TITLE) || optionsRow!.includes('MCP ·')) fail(`options composited onto another row:\n${optionsRow}`)
    if (!lines.some((line) => line.includes('The tool is not in any allow rule'))) fail('the reason row was displaced')
  }

  console.log('OpenTUI permission MCP provenance smoke passed (label, options row, reason row)')
} finally {
  act(() => { setup.renderer.destroy() })
}

process.exit(0)
