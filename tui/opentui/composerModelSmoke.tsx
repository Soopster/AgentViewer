/** @jsxImportSource @opentui/react */
// Composer model smoke: the reader may show an idle session while the composer
// auto-targets the provider's sole running turn. Model metadata belongs to that
// send target, and an overlapping reader metadata request must not discard it.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-composer-model-smoke-')))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}

const IDLE_ID = 'composer-model-idle'
const RUNNING_ID = 'composer-model-running'
const IDLE_SESSION = {
  sessionId: IDLE_ID,
  provider: 'codex' as const,
  cwd: process.cwd(),
  summary: 'Idle reader session',
  firstPrompt: 'Idle reader session',
  lastModified: 1_700_000_000_000,
}
const RUNNING_SESSION = {
  sessionId: RUNNING_ID,
  provider: 'codex' as const,
  cwd: process.cwd(),
  summary: 'Running composer target',
  firstPrompt: 'Running composer target',
  lastModified: 1_699_999_999_000,
}
const RUNNING = [{
  sessionId: RUNNING_ID,
  provider: 'codex' as const,
  pendingPrompts: [],
  pendingPermissions: [],
}]
const EMPTY_DETAIL = { info: null, rawMessages: [], threadedMessages: [], contextUsage: null }
const metadataRequests: string[] = []
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => [IDLE_SESSION, RUNNING_SESSION],
  readTuiSessionDetailAsync: async () => {
    // Let the composer-target lookup overlap the reader's follow-up metadata
    // lookup—the old global request id dropped whichever valid result finished
    // first after another session began loading.
    await delay(120)
    return EMPTY_DETAIL
  },
}))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({
  ...metadataClient,
  readTuiSessionMetadataAsync: async (session: { sessionId: string }) => {
    metadataRequests.push(session.sessionId)
    await delay(session.sessionId === RUNNING_ID ? 220 : 10)
    return {
      currentModel: session.sessionId === RUNNING_ID ? 'gpt-5.6-sol' : 'gpt-5.4',
      contextUsage: null,
    }
  },
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => [IDLE_SESSION, RUNNING_SESSION],
  readTuiSessionDetail: async () => EMPTY_DETAIL,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  listTuiRunningSessions: async () => RUNNING,
  readTuiRuntimeActivity: async () => ({ running: RUNNING, waiting: [], attention: [] }),
  prewarmTuiSession: async () => {},
  readTuiSlashCommands: async () => [],
  readTuiComposerOptions: async () => ({ agents: [], models: [] }),
}))

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 180, height: 36, kittyKeyboard: true })

try {
  await act(async () => {
    await setup.flush()
    await delay(3000)
  })
  const frame = setup.captureCharFrame()
  if (!metadataRequests.includes(RUNNING_ID)) {
    throw new Error(`Composer target metadata was never requested: ${metadataRequests.join(', ')}`)
  }
  if (!frame.includes('model:gpt-5.6-sol')) {
    throw new Error(`Composer did not adopt its running target's reported model:\n${frame}`)
  }
  if (frame.includes('model:loading')) {
    throw new Error(`Composer model remained stuck loading after metadata resolved:\n${frame}`)
  }
  console.log('OpenTUI composer target model smoke passed')
} finally {
  act(() => { setup.renderer.destroy() })
}

process.exit(0)
