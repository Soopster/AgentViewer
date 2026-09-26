/** @jsxImportSource @opentui/react */
// Launching the TUI and browsing must not load the send path.
//
// lib/agentCoordination.ts and lib/sessionBackend.ts import every provider SDK
// and the Coordinator schema; evaluating them on the render thread was the
// TUI's longest frames (~130ms) and ~40MB, and it happened on every launch
// because two surfaces reached them for whichever conversation was selected:
// the Teammates badge observed its Coordinator (for a conversation with no
// team), and Codex's composer prewarm ran on selection. Neither shows in a
// frame, so this traces module resolution while a Codex session is selected
// and browsed with the composer untouched.
//
// Full-App smokes exit rather than throw: the app's own timers keep the
// process alive past an uncaught throw.
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import type { Session } from '../../lib/types'

const resolved = new Set<string>()
type ResolveBuild = { onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => undefined): void }
const { Bun } = globalThis as unknown as { Bun: { plugin(plugin: { name: string; setup(build: ResolveBuild): void }): void } }
Bun.plugin({
  name: 'send-path-trace',
  setup(build) {
    build.onResolve({ filter: /(agentCoordination|sessionBackend|claudePool)(\.ts)?$/ }, (args) => {
      resolved.add(args.path)
      return undefined
    })
  },
})

const root = mkdtempSync(path.join(tmpdir(), 'agent-viewer-browse-send-path-'))
mkdirSync(path.join(root, '.agent-viewer-data'), { recursive: true })
writeFileSync(path.join(root, '.agent-viewer-data', 'provider.json'), JSON.stringify({ provider: 'codex', providerInstanceId: 'codex' }))
process.chdir(root)

const sessions: Session[] = Array.from({ length: 4 }, (_, index) => ({
  sessionId: `browse-send-path-${index}`,
  provider: 'codex' as const,
  cwd: root,
  summary: `Browse fixture ${index}`,
  firstPrompt: `Browse fixture ${index}`,
  lastModified: Date.now() - index * 1_000,
}))
const detail = { info: sessions[0], rawMessages: [], threadedMessages: [], transcriptCards: [], contextUsage: null }

const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as {
  mock: { module(specifier: string, factory: () => unknown): void }
}
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({
  ...detailClient,
  readTuiSessionsAsync: async () => sessions,
  readTuiSessionDetailAsync: async () => detail,
  formatTranscriptCardsAsync: async () => [],
  getTranscriptCardsSync: () => [],
  warmTranscriptAsync: async () => {},
  readTuiComposerAffordancesAsync: async () => ({ commands: [], options: { permissionModes: [], currentPermissionMode: null } }),
}))
const metadataClient = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({
  ...metadataClient,
  readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }),
}))

const { default: OpenTuiApp } = await import('./App')
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

await settle(2500)
for (let step = 0; step < 3; step += 1) {
  act(() => { setup.mockInput.pressKey('j') })
  await settle(600)
}
await settle(1500)

if (!setup.captureCharFrame().includes('Browse fixture')) {
  console.error(`the fixture sessions never rendered:\n${setup.captureCharFrame()}`)
  process.exit(1)
}
if (resolved.size > 0) {
  console.error(`browsing loaded the send path: ${[...resolved].join(', ')}`)
  process.exit(1)
}
console.log('browse send-path smoke passed (launch and browse load no send path)')
process.exit(0)
