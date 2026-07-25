import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.chdir(mkdtempSync(path.join(tmpdir(), 'agent-viewer-draft-smoke-')))
const {
  readComposerDraft,
  scheduleWriteComposerDraft,
} = await import('../../lib/tuiComposerState')

scheduleWriteComposerDraft('claude:reader-a', 'reader draft')
scheduleWriteComposerDraft('codex:pane-b', 'pane draft')

assert.equal(readComposerDraft('claude:reader-a'), 'reader draft')
assert.equal(readComposerDraft('codex:pane-b'), 'pane draft')

scheduleWriteComposerDraft('claude:reader-a', '')
assert.equal(readComposerDraft('claude:reader-a'), '')
assert.equal(readComposerDraft('codex:pane-b'), 'pane draft')

console.log('Composer draft pending writes remain isolated by target session')
