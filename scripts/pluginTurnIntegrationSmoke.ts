// Exercise the actual shared Web/TUI send boundary with provider submission stubbed.
import assert from 'node:assert/strict'
// @ts-expect-error Bun provides this at runtime; the app deliberately uses Node's type environment.
import { mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createContextAttachment, contextReference, readComposerContext } from '../lib/composerContext'
import { writePluginSettingsFile } from '../lib/plugins/settingsFile'

const temporary = mkdtempSync(path.join(tmpdir(), 'plugin-turn-'))
const previousSettings = process.env.AGENT_VIEWER_PLUGIN_SETTINGS
process.env.AGENT_VIEWER_PLUGIN_SETTINGS = path.join(temporary, 'plugins.json')
let submissions = 0
let checkpoints = 0
let reopens = 0
let received: Record<string, unknown> = {}
const providerRegistry = await import('../lib/extensions/providers/registry')
const checkpointModule = await import('../lib/checkpoints')
const inboxModule = await import('../lib/sessionInbox')
mock.module('../lib/extensions/providers/registry', () => ({
  ...providerRegistry,
  getProviderRuntime: async () => ({ streamTurn: async (request: { body: Record<string, unknown> }) => {
    submissions++
    received = request.body
    return new Response('submitted')
  } }),
}))
mock.module('../lib/checkpoints', () => ({ ...checkpointModule, createTurnCheckpoint: async () => { checkpoints++; return null } }))
mock.module('../lib/sessionInbox', () => ({ ...inboxModule, updateSessionInboxState: async () => { reopens++ } }))
const { streamViewSessionTurn } = await import('../lib/sessionBackend')
const send = (body: Record<string, unknown>, signal = new AbortController().signal) => streamViewSessionTurn({
  provider: 'codex', sessionId: 'fixture', body, signal,
})
try {
  writePluginSettingsFile({ version: 1, disabled: [] })
  const attachment = createContextAttachment('terminal', 'Build log', 'all good')
  const text = `Review ${contextReference(attachment)}`
  assert.equal((await send({ message: text, attachments: [attachment] })).status, 200)
  assert.equal(submissions, 1)
  assert.equal(readComposerContext(String(received.message)).records[0].text, 'all good')
  assert.deepEqual(received.attachments, [])

  const refused = await send({ message: 'Review [missing](av-context://missing)', cwd: temporary })
  assert.equal(refused.status, 400)
  assert.match((await refused.json()).error, /reference is unavailable/)
  assert.equal(submissions, 1)
  assert.equal(checkpoints, 0, 'a blocked hook cannot create a checkpoint')
  assert.equal(reopens, 1, 'a blocked hook cannot reopen the inbox')

  const controller = new AbortController()
  controller.abort()
  assert.equal((await send({ message: 'cancelled', cwd: temporary }, controller.signal)).status, 499)
  assert.equal(submissions, 1)

  writePluginSettingsFile({ version: 1, disabled: ['composer-context'] })
  assert.equal((await send({ message: 'plain message' })).status, 200)
  assert.equal(received.message, 'plain message')
  writePluginSettingsFile({ version: 1, disabled: [] })
  assert.equal((await send({ message: text, attachments: [attachment] })).status, 200)
  assert.equal(readComposerContext(String(received.message)).records.length, 1)
  console.log('plugin turn integration: PASS (shared send pipeline, expansion, refusal before side effects, cancellation, re-enable)')
} finally {
  mock.restore()
  if (previousSettings === undefined) delete process.env.AGENT_VIEWER_PLUGIN_SETTINGS
  else process.env.AGENT_VIEWER_PLUGIN_SETTINGS = previousSettings
  rmSync(temporary, { recursive: true, force: true })
}
