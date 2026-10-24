import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-draft-smoke-')))
const {
  COMPOSER_STASH_MAX,
  flushComposerQueueWrites,
  flushComposerStashWrites,
  readComposerDraft,
  readComposerDraftParts,
  readComposerStash,
  scheduleWriteComposerDraft,
  scheduleWriteComposerDraftParts,
  scheduleWriteComposerQueue,
  scheduleWriteComposerStash,
} = await import('../../lib/tuiComposerState')

scheduleWriteComposerDraft('claude:reader-a', 'reader draft')
scheduleWriteComposerDraft('codex:pane-b', 'pane draft')

assert.equal(readComposerDraft('claude:reader-a'), 'reader draft')
assert.equal(readComposerDraft('codex:pane-b'), 'pane draft')

scheduleWriteComposerDraft('claude:reader-a', '')
assert.equal(readComposerDraft('claude:reader-a'), '')
assert.equal(readComposerDraft('codex:pane-b'), 'pane draft')

// The content behind a draft's placeholders persists with it, and writing the
// text alone keeps it: saved text without it restored "[Pasted ~200 lines]"
// with nothing behind it, which then sent the placeholder literally.
const pastedPart = { id: 'p1', kind: 'text', marker: '[Pasted ~3 lines]', text: 'a\nb\nc' }
scheduleWriteComposerDraft('claude:paste', 'see [Pasted ~3 lines]')
scheduleWriteComposerDraftParts('claude:paste', [pastedPart])
scheduleWriteComposerDraft('claude:paste', 'see [Pasted ~3 lines] and more')
assert.deepEqual(readComposerDraftParts('claude:paste'), [pastedPart], 'a text write keeps the parts')
await new Promise((resolve) => setTimeout(resolve, 400))
const draftFile = JSON.parse(readFileSync(path.join(process.cwd(), '.agent-viewer-data', 'composer-drafts', 'drafts.json'), 'utf8'))
assert.deepEqual(draftFile['claude:paste'], { text: 'see [Pasted ~3 lines] and more', parts: [pastedPart] }, 'parts reach the file')

const queued = [{
  id: 'codex:thread-1:1',
  targetKey: 'codex:thread-1',
  text: 'durable follow-up',
  attachments: [],
  promptParts: [],
}]
scheduleWriteComposerQueue(queued)
assert.equal(flushComposerQueueWrites(), true)
const queueFile = path.join(process.cwd(), '.agent-viewer-data', 'composer-drafts', 'queue-v1.json')
assert.deepEqual(JSON.parse(readFileSync(queueFile, 'utf8')), { version: 1, entries: queued })

scheduleWriteComposerQueue([])
assert.equal(flushComposerQueueWrites(), true)
assert.deepEqual(JSON.parse(readFileSync(queueFile, 'utf8')), { version: 1, entries: [] })

// ── the stash ──────────────────────────────────────────────────────────────
// A stash exists because you are not ready to send, and "not ready" outlives a
// session — so the entries have to reach disk, carrying their attachments and
// prompt parts rather than text alone.
type StashEntry = { text: string; attachments: unknown[]; promptParts: unknown[] }
const isStashEntry = (value: unknown): value is StashEntry =>
  Boolean(value) && typeof value === 'object'
  && typeof (value as StashEntry).text === 'string'
  && Array.isArray((value as StashEntry).attachments)

const shelved: StashEntry[] = [
  { text: 'older idea', attachments: [], promptParts: [] },
  { text: 'newer idea', attachments: [{ id: 'a1', type: 'file' }], promptParts: [] },
]
scheduleWriteComposerStash(shelved)
assert.equal(flushComposerStashWrites(), true)
const stashFile = path.join(process.cwd(), '.agent-viewer-data', 'composer-drafts', 'stash-v1.json')
assert.deepEqual(JSON.parse(readFileSync(stashFile, 'utf8')), { version: 1, entries: shelved })
assert.deepEqual(readComposerStash(isStashEntry), shelved,
  'A shelved draft reads back with its attachments, not just its text')

// The cap keeps the newest: dropping the end would discard the draft the user
// just shelved, which is the one they are most likely to want back.
const many = Array.from({ length: COMPOSER_STASH_MAX + 5 }, (_, index) => ({
  text: `entry-${index}`,
  attachments: [],
  promptParts: [],
}))
scheduleWriteComposerStash(many)
assert.equal(flushComposerStashWrites(), true)
const capped = readComposerStash(isStashEntry)
assert.equal(capped.length, COMPOSER_STASH_MAX)
assert.equal(capped[capped.length - 1]?.text, `entry-${COMPOSER_STASH_MAX + 4}`,
  'The most recently stashed entry must survive the cap')

// The stash and the follow-up queue are separate files: restoring a shelved
// draft must not disturb work already queued to send.
assert.deepEqual(JSON.parse(readFileSync(queueFile, 'utf8')), { version: 1, entries: [] })

console.log('Composer drafts remain isolated, and queue and stash commits flush atomically to separate files')
