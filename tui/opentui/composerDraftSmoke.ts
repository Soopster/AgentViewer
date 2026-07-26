import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-draft-smoke-')))
const {
  flushComposerQueueWrites,
  readComposerDraft,
  scheduleWriteComposerDraft,
  scheduleWriteComposerQueue,
} = await import('../../lib/tuiComposerState')

scheduleWriteComposerDraft('claude:reader-a', 'reader draft')
scheduleWriteComposerDraft('codex:pane-b', 'pane draft')

assert.equal(readComposerDraft('claude:reader-a'), 'reader draft')
assert.equal(readComposerDraft('codex:pane-b'), 'pane draft')

scheduleWriteComposerDraft('claude:reader-a', '')
assert.equal(readComposerDraft('claude:reader-a'), '')
assert.equal(readComposerDraft('codex:pane-b'), 'pane draft')

const queued = [{
  id: 'codex:thread-1:1',
  targetKey: 'codex:thread-1',
  text: 'durable follow-up',
  attachments: [],
  promptParts: [],
}]
scheduleWriteComposerQueue(queued)
flushComposerQueueWrites()
const queueFile = path.join(process.cwd(), '.agent-viewer-data', 'composer-drafts', 'queue-v1.json')
assert.deepEqual(JSON.parse(readFileSync(queueFile, 'utf8')), { version: 1, entries: queued })

scheduleWriteComposerQueue([])
flushComposerQueueWrites()
assert.deepEqual(JSON.parse(readFileSync(queueFile, 'utf8')), { version: 1, entries: [] })

console.log('Composer drafts remain isolated and follow-up queue commits flush atomically')
