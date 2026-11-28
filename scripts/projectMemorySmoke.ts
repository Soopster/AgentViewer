import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { AGENT_NOTE_LIMIT, createProjectMemory, nativeProjectMemory, recallProjectMemory, resetProjectMemorySessions } from '../lib/project-memory/service'
import { blankMemory, memoryDraft, MEMORY_PROTOCOL, parseMemoryTags, projectMemoryContext, rankProjectMemory } from '../lib/plugins/projectMemory'
import { behavior } from '../plugins/project-memory/server'
import { manifest } from '../plugins/project-memory/manifest'

import { findPluginBlockRegions, patternBlockParser, registerBlockParser } from '../lib/blockRegistry'
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

  // ── Agents keep their own memory ──────────────────────────────────────────────────────────────────
  resetProjectMemorySessions()
  const signal = new AbortController().signal
  const agentRepo = path.join(temp, 'agent-repo'), sub = path.join(agentRepo, 'packages', 'app'), tree = path.join(temp, 'agent-tree')
  await mkdir(sub, { recursive: true })
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
  git(agentRepo, 'init', '-q'); git(agentRepo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'); git(agentRepo, 'worktree', 'add', '-q', tree)
  const first = await recallProjectMemory({ target: { provider: 'claude', sessionId: 'a1' }, body: { cwd: agentRepo, message: 'Start work' }, signal })
  assert(first?.includes(MEMORY_PROTOCOL), 'a first turn is told how to remember, even with nothing stored')
  assert.equal(await recallProjectMemory({ target: { provider: 'claude', sessionId: 'a1' }, body: { cwd: agentRepo, message: 'Continue' }, signal }), null, 'the protocol is not repeated on later turns')
  const reply = (text: string, uuid: string) => async () => [
    { type: 'user', uuid: 'u1', session_id: 'a1', parent_tool_use_id: null, message: { role: 'user', content: 'Fix the build' } },
    { type: 'assistant', uuid, session_id: 'a1', parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'text', text }] } },
  ] as never
  const tagged = 'Done.\n<memory title="Build uses Bun" kind="convention">Run the TUI with Bun; node cannot load @opentui.</memory>\n```\n<memory title="Example">not real</memory>\n```'
  assert.deepEqual(parseMemoryTags(tagged).map(tag => tag.title), ['Build uses Bun'], 'tags inside code are not memories')
  await behavior.afterTurn!({ target: { provider: 'claude', sessionId: 'a1' }, signal, followUps: 0, readMessages: reply(tagged, 'm1') })
  await behavior.afterTurn!({ target: { provider: 'claude', sessionId: 'a1' }, signal, followUps: 0, readMessages: reply(tagged, 'm1') })
  let agentSnap = await nativeProjectMemory.peek(agentRepo)
  assert.equal(agentSnap.notes.length, 1, 'a reply observed twice saves once')
  assert.equal(agentSnap.notes[0].author, 'agent'); assert.equal(agentSnap.notes[0].source?.messageUuid, 'm1')
  assert.equal((await nativeProjectMemory.peek(sub)).notes.length, 1, 'a subdirectory shares the repository memory')
  assert.equal((await nativeProjectMemory.peek(tree)).notes.length, 1, 'a worktree shares the repository memory')
  const recalledInOther = await recallProjectMemory({ target: { provider: 'codex', sessionId: 'b1' }, body: { cwd: tree, message: 'How do I run the TUI with Bun?' }, signal })
  assert(recalledInOther?.includes('node cannot load @opentui'), 'an agent note is recalled in a new session without approval')
  assert.equal(await recallProjectMemory({ target: { provider: 'codex', sessionId: 'b1' }, body: { cwd: tree, message: 'And Bun flags?' }, signal }), null, 'a note already shown to a session is not shown again')
  await behavior.afterTurn!({ target: { provider: 'claude', sessionId: 'a1' }, signal, followUps: 0, readMessages: reply('<memory title="build uses  bun" kind="lesson">Bun 1.3 or later is required.</memory>', 'm2') })
  agentSnap = await nativeProjectMemory.peek(agentRepo)
  assert.equal(agentSnap.notes.length, 1, 'the same title updates rather than adding'); assert.equal(agentSnap.notes[0].version, 2)
  assert((await recallProjectMemory({ target: { provider: 'codex', sessionId: 'b1' }, body: { cwd: tree, message: 'Bun version?' }, signal }))?.includes('Bun 1.3'), 'an updated note is shown again')
  // A person's note: recalled only once approved, never forgotten by an agent.
  const personNote = { ...blankMemory(), title: 'Release owner', body: 'Releases are cut by a person.', kind: 'decision' as const }
  agentSnap = await nativeProjectMemory.mutate(agentRepo, crypto.randomUUID(), { type: 'save', note: personNote })
  await assert.rejects(nativeProjectMemory.mutate(agentRepo, crypto.randomUUID(), { type: 'agent-forget', title: 'release owner' }), /written by a person/)
  // Tools, for agents in other programs.
  const tools = behavior.tools!
  assert.match(String(await tools.remember({ title: 'Ports', body: 'The dev server listens on 3000.', kind: 'convention' }, { signal, cwd: sub })), /^Remembered/)
  assert.match(String(await tools.recall({ query: 'dev server port' }, { signal, cwd: agentRepo })), /listens on 3000/)
  assert.match(String(await tools.recall({}, { signal, cwd: agentRepo })), /2 memories/, 'an unapproved person note is not listed')
  assert.match(String(await tools.recall({ project: agentRepo }, { signal })), /2 memories/, 'project overrides a missing cwd')
  await assert.rejects(async () => tools.recall({}, { signal }), /pass "project"/)
  assert.match(String(await tools.forget({ title: 'Ports' }, { signal, cwd: agentRepo })), /Forgot/)
  // Turned off: agents neither save nor recall.
  agentSnap = await nativeProjectMemory.peek(agentRepo)
  agentSnap = await nativeProjectMemory.mutate(agentRepo, crypto.randomUUID(), { type: 'settings', agentMemory: false, expectedSequence: agentSnap.sequence })
  assert.equal(agentSnap.autoRecall, false, 'one setting does not reset the other')
  assert.equal(projectMemoryContext(agentSnap, 'Bun'), '', 'agent notes leave recall when agent memory is off')
  assert.match(String(await tools.remember({ title: 'x', body: 'y' }, { signal, cwd: agentRepo })), /turned off/)
  assert.equal(await recallProjectMemory({ target: { provider: 'pi', sessionId: 'c1' }, body: { cwd: agentRepo, message: 'Bun' }, signal }), null, 'no protocol when agents may not write')
  // The cap is a refusal with a way forward, never an eviction.
  const capDir = path.join(temp, 'cap'); await mkdir(capDir)
  for (let i = 0; i < AGENT_NOTE_LIMIT; i++) await nativeProjectMemory.mutate(capDir, crypto.randomUUID(), { type: 'agent-remember', title: `n${i}`, body: 'b', kind: 'lesson' })
  await assert.rejects(nativeProjectMemory.mutate(capDir, crypto.randomUUID(), { type: 'agent-remember', title: 'one more', body: 'b', kind: 'lesson' }), /Forget outdated/)
  // A store kept under the exact directory before repository keying is still found.
  const legacyRepo = path.join(temp, 'legacy'), legacySub = path.join(legacyRepo, 'src'); await mkdir(legacySub, { recursive: true }); git(legacyRepo, 'init', '-q')
  const { createHash } = await import('node:crypto')
  const legacyFile = path.join(process.env.AGENT_VIEWER_PROJECT_MEMORY_DIR!, `${createHash('sha256').update(await realpath(legacySub)).digest('hex')}.sqlite`)
  const legacyService = createProjectMemory(() => process.env.AGENT_VIEWER_PROJECT_MEMORY_DIR!)
  assert.notEqual(await legacyService.file(legacySub), legacyFile)
  const { writeFile } = await import('node:fs/promises'); await writeFile(legacyFile, '')
  assert.equal(await createProjectMemory(() => process.env.AGENT_VIEWER_PROJECT_MEMORY_DIR!).file(legacySub), legacyFile, 'the legacy per-directory store is used when the repository has none')
  // Cards: the recalled block folds the protocol with it; a memory tag is drawn as what was remembered.
  for (const spec of manifest.blocks) { const parser = patternBlockParser(`project-memory.${spec.kind}`, spec, 'project-memory'); assert(parser, `${spec.kind} pattern is accepted`); registerBlockParser(parser) }
  const regions = findPluginBlockRegions(first!).sort((a, b) => a.start - b.start)
  assert.equal(regions[0].kind, 'project-memory.recalled'); assert.equal(regions[0].end, first!.length)
  assert.equal(findPluginBlockRegions(tagged).find(region => region.kind === 'project-memory.remembered')?.card.title, 'Remembered: Build uses Bun')
  console.log('Project Memory: PASS (agent memory: protocol, capture, repository keying, worktrees, per-session dedupe, upsert, person-note guard, tools, off switch, cap, legacy store, cards; review gating, opt-in recall, cross-provider sources, repository isolation, edits, stale writes, deletion generations, replay safety, relevance, bounded context)')
} finally { await rm(temp, { recursive: true, force: true }) }
