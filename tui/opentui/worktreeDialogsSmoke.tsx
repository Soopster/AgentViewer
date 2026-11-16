/** @jsxImportSource @opentui/react */
// The worktree task prompts are the worktree-tasks plugin: ⇧F opens the name prompt over the
// app, typing reaches its field, Esc closes it and clears the draft.
import React from 'react'
import { testRender, act } from './testRender'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-worktree-dialogs-smoke-')))
const bunTestSpecifier = 'bun:test'
const { mock } = await import(bunTestSpecifier) as { mock: { module(specifier: string, factory: () => unknown): void } }
const detailClient = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...detailClient, readTuiSessionsAsync: async () => [] }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service, readTuiSessions: async () => [] }))
const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 120, height: 40, kittyKeyboard: true })
const settle = async (ms: number) => {
  const until = Date.now() + ms
  while (Date.now() < until) await act(async () => { await setup.flush(); await new Promise((resolve) => setTimeout(resolve, 16)) })
}
const fail = (message: string): never => { console.error(message); process.exit(1) }
const frame = () => setup.captureCharFrame()

await settle(1500)
await act(async () => { setup.mockInput.pressKey('F') })
await settle(500)
if (!frame().includes('New worktree task')) fail(`⇧F did not open the worktree prompt:\n${frame()}`)
await act(async () => { await setup.mockInput.typeText('fix-login') })
await settle(300)
if (!frame().includes('fix-login')) fail('typing did not reach the name field')
await act(async () => { setup.mockInput.pressEscape() })
await settle(400)
if (frame().includes('New worktree task')) fail('Esc left the prompt open')
await act(async () => { setup.mockInput.pressKey('F') })
await settle(500)
if (frame().includes('fix-login')) fail('the draft survived a cancel')
await act(async () => { setup.mockInput.pressEscape() })
await settle(300)
console.log('worktree dialogs smoke passed (opens, types, cancels and clears)')
process.exit(0)
