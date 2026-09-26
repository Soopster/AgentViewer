/** @jsxImportSource @opentui/react */
// An idle app must not re-render its root.
//
// The live-turn registry poll runs every REATTACH_POLL_MS from boot and reads
// fresh `waiting` / `attention` arrays each time. Storing them unconditionally
// re-rendered the whole root on every poll — mounted transcript included — for
// as long as the app was open, with nothing on screen changing. The frame is
// identical either way, so this reads `readRootRenderCount()`.
//
// Sessions are stubbed empty so the only thing left moving is the registry
// poll itself (a real session list refreshes on its own schedule and would be
// a legitimate render). Full-App smokes exit rather than throw: the app's own
// timers keep the process alive past an uncaught throw.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-idle-render-smoke-')))

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => [],
}))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({
  ...service,
  readTuiSessions: async () => [],
}))

const { default: OpenTuiApp, readRootRenderCount } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
const settle = async (ms: number) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    await act(async () => {
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 16))
    })
  }
}

await settle(4000)
const before = readRootRenderCount()
// Several registry polls (1.5s apart) with nothing changing.
await settle(6000)
const renders = readRootRenderCount() - before
if (renders !== 0) {
  console.error(`an idle app re-rendered its root ${renders} time(s) in 6s`)
  process.exit(1)
}
console.log('idle render smoke passed (no root renders while idle)')
process.exit(0)
