import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createProjectMemory, recallProjectMemory } from '../lib/project-memory/service'
import { blankMemory, memoryDraft, projectMemoryContext, rankProjectMemory } from '../lib/plugins/projectMemory'
const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'project-memory-'))), cwd = path.join(temp, 'repo'), other = path.join(temp, 'other')
await mkdir(cwd); await mkdir(other); process.env.AGENT_VIEWER_PROJECT_MEMORY_DIR = path.join(temp, 'data')
const service = createProjectMemory(() => process.env.AGENT_VIEWER_PROJECT_MEMORY_DIR!)
const mutate = (operation: Parameters<typeof service.mutate>[2], requestId = crypto.randomUUID()) => service.mutate(cwd, requestId, operation)
try {
  let snapshot = await service.read(cwd)
  assert.equal(snapshot.autoRecall, false)
  const note = { ...blankMemory(), title: 'SQLite import boundary', body: 'Use the existing dynamic import indirection for SQLite so Next bundling preserves it.', kind: 'convention' as const, source: { provider: 'codex' as const, providerInstanceId: 'work', sessionId: 'source', messageUuid: 'message-1' } }
  const requestId = crypto.randomUUID()
  snapshot = await mutate({ type: 'save', note }, requestId)
  assert.equal(snapshot.notes[0].reviewed, false)
  assert.equal((await mutate({ type: 'save', note }, requestId)).sequence, snapshot.sequence, 'replay creates no second note')
  snapshot = await mutate({ type: 'settings', autoRecall: true, expectedSequence: snapshot.sequence })
  assert.equal(projectMemoryContext(snapshot, 'Fix SQLite imports'), '', 'drafts never enter recall')
  snapshot = await mutate({ type: 'review', id: note.id, expectedVersion: 1, reviewed: true })
  const recalled = projectMemoryContext(snapshot, 'Fix SQLite imports')
  assert(recalled.includes('dynamic import indirection') && recalled.includes('codex@work/source#message-1'))
  assert.equal(projectMemoryContext(snapshot, 'Unrelated garden design'), '')
  assert.equal((await service.read(other)).notes.length, 0, 'repositories are isolated')
  const context = await recallProjectMemory({ target: { provider: 'pi', sessionId: 'other-provider' }, body: { cwd, message: 'Fix SQLite imports' }, signal: new AbortController().signal })
  assert(context?.includes('<agent_viewer_project_memory>') && context.includes('SQLite import boundary'), 'approved project memory is shared across providers')
  assert.equal(await recallProjectMemory({ target: { provider: 'pi', sessionId: 's' }, body: { cwd, message: context }, signal: new AbortController().signal }), null, 'context is not injected twice')
  assert.equal(await recallProjectMemory({ target: { provider: 'pi', sessionId: 's' }, body: { cwd, message: '/help' }, signal: new AbortController().signal }), null)
  const old = snapshot.notes[0]
  snapshot = await mutate({ type: 'save', note: { ...memoryDraft(old), body: 'Updated approved advice', pinned: true } })
  assert(!snapshot.notes[0].reviewed, 'editing requires approval again')
  await assert.rejects(mutate({ type: 'review', id: old.id, expectedVersion: old.version, reviewed: true }), /changed/)
  snapshot = await mutate({ type: 'review', id: old.id, expectedVersion: snapshot.notes[0].version, reviewed: true })
  assert(projectMemoryContext(snapshot, 'Unrelated request').includes('Updated approved advice'), 'approved pinned notes are always eligible')
  const large = Array.from({ length: 20 }, (_, i) => ({ ...snapshot.notes[0], id: `n${i}`, body: 'x'.repeat(20_000), pinned: true }))
  assert(projectMemoryContext({ ...snapshot, notes: large }, 'request').length < 8300)
  assert.equal(rankProjectMemory(snapshot.notes, 'updated')[0].id, note.id)
  const beforeDelete = snapshot.notes[0]
  snapshot = await mutate({ type: 'delete', id: beforeDelete.id, expectedVersion: beforeDelete.version })
  await assert.rejects(mutate({ type: 'save', note }), /changed/, 'an old creation draft cannot resurrect a deleted note')
  assert.equal(snapshot.notes.length, 0)
  console.log('Project Memory: PASS (review gating, opt-in recall, cross-provider sources, repository isolation, edits, stale writes, deletion generations, replay safety, relevance, bounded context)')
} finally { await rm(temp, { recursive: true, force: true }) }
