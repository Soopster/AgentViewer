/** @jsxImportSource @opentui/react */
// The session pull request in the real App: a transcript that opened one links
// it, the window's bottom border says where it stands, and its next step lands in
// the composer as a prompt rather than being sent.
import assert from 'node:assert/strict'
import React from 'react'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildThreadedMessages } from '../../lib/threading'
import type { Session, SessionMessage } from '../../lib/types'
import { formatTranscriptCards } from '../format'
import { act, testRender } from './testRender'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-session-pr-')))
delete process.env.AGENT_VIEWER_ATTACH

const session: Session = { sessionId: 'pr-session', provider: 'claude', summary: 'open a pull request', firstPrompt: 'open a pull request', cwd: process.cwd(), lastModified: Date.now() - 3600_000 }
const rawMessages = [
  { type: 'assistant', uuid: 'a1', session_id: 'pr-session', parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'gh pr create --title "Fix it" --base main' } }] } },
  { type: 'user', uuid: 'r1', session_id: 'pr-session', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'https://github.com/o/r/pull/12' }] } },
] as SessionMessage[]
const threadedMessages = buildThreadedMessages(rawMessages)
const detail = { info: { sessionId: 'pr-session' }, rawMessages, threadedMessages, transcriptCards: formatTranscriptCards(threadedMessages), transcriptCardsDensity: 'balanced' as const, transcriptCardsShowToolCalls: true, contextUsage: null }

const links: Array<{ action: string; url?: string }> = []
const bunTest = 'bun:test'
const { mock } = await import(bunTest) as { mock: { module: (name: string, factory: () => unknown) => void } }
const worker = await import('./sessionDetailWorkerClient')
mock.module('./sessionDetailWorkerClient', () => ({ ...worker, readTuiSessionsAsync: async () => [session], readTuiSessionDetailAsync: async () => detail }))
const metadata = await import('./metadataWorkerClient')
mock.module('./metadataWorkerClient', () => ({ ...metadata, readTuiSessionMetadataAsync: async () => ({ currentModel: null, contextUsage: null }) }))
const service = await import('../../lib/tui/service')
mock.module('../../lib/tui/service', () => ({ ...service,
  readTuiSessions: async () => [session], readTuiSessionDetail: async () => detail,
  readTuiSessionMetadata: async () => ({ models: [], currentModel: null, contextUsage: null }),
  readTuiRuntimeActivity: async () => ({ running: [], waiting: [], attention: [] }), listTuiRunningSessions: async () => [], prewarmTuiSession: async () => {},
  updateTuiSessionInbox: async (_target: unknown, action: string, linkedPr?: { url: string }) => {
    links.push({ action, url: linkedPr?.url })
    return linkedPr ? { linkedPr } : {}
  },
}))
const store = await import('./sessionPrStore')
const reads: Array<{ number: number; repo?: string }> = []
store.setSessionPrReader(async (_cwd, number, repo) => {
  reads.push({ number, repo })
  return {
    number, title: 'Fix it', state: 'OPEN', isDraft: false, url: 'https://github.com/o/r/pull/12', author: 'me', headRefName: 'fix', baseRefName: 'main', updatedAt: '', reviewDecision: '', labels: [], checks: 'failure',
    body: '', additions: 1, deletions: 0, changedFiles: 1, mergeable: 'MERGEABLE', mergeStateStatus: '', reviewRequests: [], assignees: [], reviews: [], commits: [], files: [], comments: [], threads: [],
    checkRuns: [{ name: 'lint', state: 'failure', url: '' }],
  }
})

const { default: OpenTuiApp } = await import('./App')
const setup = await testRender(<OpenTuiApp />, { width: 150, height: 40, kittyKeyboard: true })
const settle = async (ms = 150) => { await act(async () => { await setup.flush(); await new Promise(resolve => setTimeout(resolve, ms)); await setup.flush() }) }
const waitFor = async (what: string, test: () => boolean) => {
  for (let attempt = 0; attempt < 40; attempt++) { if (test()) return; await settle() }
  assert.fail(`${what}\n${setup.captureCharFrame()}`)
}
try {
  await waitFor('The transcript that opened a pull request links it', () => links.some(link => link.action === 'auto-link-pr'))
  assert.deepEqual(links.filter(link => link.action === 'auto-link-pr'), [{ action: 'auto-link-pr', url: 'https://github.com/o/r/pull/12' }])
  await waitFor('The window border shows the pull request and its next step', () => /#12 1 check failing/.test(setup.captureCharFrame()) && /▸ Fix checks/.test(setup.captureCharFrame()))
  // The read names the linked repository, never just a number the checkout would answer for.
  assert.deepEqual(reads[0], { number: 12, repo: 'o/r' })
  assert.match(setup.captureCharFrame(), /Opened pull request #12 · Fix it/)
  const button = setup.renderer.root.findDescendantById('reader-pr-action') as unknown as { x: number; y: number } | undefined
  assert.ok(button, 'Next step is clickable')
  await act(async () => { await setup.mockMouse.click(button.x + 2, button.y) })
  await waitFor('The prompt lands in the composer', () => /These checks are failing/.test(setup.captureCharFrame()) || /Pasted/.test(setup.captureCharFrame()))
  assert.equal(links.filter(link => link.action === 'auto-link-pr').length, 1)
  console.log('sessionPrSmoke: PASS')
} finally {
  await act(async () => { setup.renderer.destroy() })
}
process.exit(0)
