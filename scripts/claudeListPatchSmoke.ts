// The Claude session list is patched where the corpus changed, and a patched
// page is the page a full derive would return.
//
// Run with bun. A hand-written Claude store; no Claude process is started.
// Every step compares the adapter's page with the SDK's own listSessions
// (ground truth) and counts how many full derives the cache paid for, because
// a wrong patch renders as a plausible sidebar — an old title, a session in the
// wrong place — and a cache that silently stopped patching renders identically.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = '-tmp-list-patch-smoke'

function line(sessionId: string, parentUuid: string | null, role: 'user' | 'assistant', text: string, at: Date) {
  const base = { isSidechain: false, sessionId, cwd: '/tmp/list-patch-smoke', userType: 'external', version: '2.1.0', parentUuid, uuid: randomUUID(), timestamp: at.toISOString() }
  const message = role === 'user'
    ? { role: 'user', content: text }
    : { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: 'smoke', content: [{ type: 'text', text }] }
  return { ...base, type: role, message }
}

function transcriptPath(configDir: string, sessionId: string): string {
  return path.join(configDir, 'projects', PROJECT, `${sessionId}.jsonl`)
}

function writeSession(configDir: string, label: string, ageMinutes: number): string {
  const sessionId = randomUUID()
  mkdirSync(path.join(configDir, 'projects', PROJECT), { recursive: true })
  const at = new Date(Date.now() - ageMinutes * 60_000)
  const user = line(sessionId, null, 'user', `prompt ${label}`, at)
  const reply = line(sessionId, user.uuid, 'assistant', `reply ${label}`, at)
  const file = transcriptPath(configDir, sessionId)
  writeFileSync(file, `${JSON.stringify(user)}\n${JSON.stringify(reply)}\n`)
  utimesSync(file, at, at)
  return sessionId
}

function appendTurn(configDir: string, sessionId: string, text: string): void {
  const now = new Date()
  const user = line(sessionId, null, 'user', text, now)
  appendFileSync(transcriptPath(configDir, sessionId), `${JSON.stringify(user)}\n`)
}

if (process.argv[2] !== 'child') {
  const dir = mkdtempSync(path.join(tmpdir(), 'claude-list-patch-'))
  const configDir = path.join(dir, 'claude')
  const ids = Array.from({ length: 6 }, (_, index) => writeSession(configDir, `${index}`, 60 - index))
  const run = (phase: string) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child', phase, dir, configDir, ...ids], {
    stdio: 'inherit', env: { ...process.env, CLAUDE_CONFIG_DIR: configDir }, timeout: 60_000,
  })
  assert.equal(run('first').status, 0, 'claude list patch smoke failed in the first process')
  // A fresh process patches the previous one's page from the snapshot.
  appendTurn(configDir, ids[0], 'written while no process was running')
  assert.equal(run('restart').status, 0, 'claude list patch smoke failed in the restarted process')
  console.log('Claude list patch smoke passed (a changed transcript is patched in place and re-sorted; a write to a transcript the list drops is answered without a derive, until it becomes listable; a new, removed or continued transcript re-derives; a restarted process patches from the snapshot; every page equals the SDK\'s own)')
} else {
  const [phase, dir, configDir, ...ids] = process.argv.slice(3) as [string, string, string, ...string[]]
  process.chdir(dir)
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  const cache = await import('../lib/claudeSessionListCache')
  const { claudeAdapter, claudeListHasEntry, readClaudeListEntry } = await import('../lib/adapters/claude')

  let derives = 0
  const page = () => cache.readClaudeCorpus().then((corpus) => cache.readClaudeListPage({
    key: 'smoke',
    patchable: true,
    corpus,
    derive: async () => { derives += 1; return sdk.listSessions({ limit: 50 }) },
    readEntry: readClaudeListEntry,
    hasEntry: claudeListHasEntry,
  }))
  const truth = () => sdk.listSessions({ limit: 50 })
  const same = async (label: string) => {
    const [ours, theirs] = await Promise.all([page(), truth()])
    // A snapshot is JSON, which drops undefined fields; absent and undefined
    // read the same to every consumer.
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value))
    assert.deepEqual(plain(ours), plain(theirs), `${label}: the cached page differs from the SDK's own listing`)
    return ours
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 15))

  if (phase === 'first') {
    await same('first list')
    assert.equal(derives, 1)
    await same('unchanged')
    assert.equal(derives, 1, 'an unchanged corpus was re-derived')

    // A running turn: the oldest session gains a turn and must move to the top.
    await settle()
    appendTurn(configDir, ids[0], 'a new turn')
    const patched = await same('appended turn')
    assert.equal(derives, 1, 'an appended turn re-derived the page instead of patching it')
    assert.equal(patched[0]?.sessionId, ids[0], 'the patched session was not re-sorted to the top')

    // A rename is a transcript write too.
    await settle()
    await sdk.renameSession(ids[3], 'Renamed in place')
    const renamed = await same('rename')
    assert.equal(derives, 1, 'a rename re-derived the page instead of patching it')
    assert.equal(renamed.find((session) => session.sessionId === ids[3])?.customTitle, 'Renamed in place')

    // An entry the SDK lists with no first prompt (its head is all metadata)
    // still patches: the derive gives it the same getSessionInfo merge.
    await settle()
    const bare = randomUUID()
    writeFileSync(transcriptPath(configDir, bare), `${JSON.stringify({ type: 'summary', summary: 'metadata only', leafUuid: randomUUID() })}\n`)
    const withBare = await same('metadata-only session added')
    assert.ok(withBare.some((session) => session.sessionId === bare && session.firstPrompt === undefined), 'the fixture no longer lists without a first prompt; this step tests nothing')
    const bareBefore = derives
    await settle()
    appendFileSync(transcriptPath(configDir, bare), `${JSON.stringify({ type: 'summary', summary: 'metadata only, renamed', leafUuid: randomUUID() })}\n`)
    await same('metadata-only session written')
    assert.equal(derives, bareBefore, 'a listed session with no first prompt re-derived the page instead of patching it')

    // A new session cannot be patched in: the list's own filters decide it.
    await settle()
    const addedBefore = derives
    const added = writeSession(configDir, 'added', 0)
    const withAdded = await same('added session')
    assert.equal(derives, addedBefore + 1, 'a new transcript did not re-derive the page')
    assert.ok(withAdded.some((session) => session.sessionId === added))

    // A session continued in another leaves the list by the SDK's own rule,
    // which getSessionInfo does not apply: patching it would keep it listed.
    await settle()
    const continuedBefore = derives
    appendFileSync(transcriptPath(configDir, ids[1]), `${JSON.stringify({ type: 'continued-in', continuedInSessionId: ids[2] })}\n`)
    const continued = await same('continued in another session')
    assert.equal(derives, continuedBefore + 1, 'a session continued elsewhere was patched instead of re-derived')
    assert.ok(!continued.some((session) => session.sessionId === ids[1]), 'the SDK no longer drops a continued session; this fixture tests nothing')

    // A removed session re-derives.
    await settle()
    rmSync(transcriptPath(configDir, ids[5]))
    const removed = await same('removed session')
    assert.ok(!removed.some((session) => session.sessionId === ids[5]))

    // A transcript the list drops (nothing to show yet) is written to and still
    // has nothing to show: the page stands. Then it gains a prompt and enters.
    const hidden = randomUUID()
    writeFileSync(transcriptPath(configDir, hidden), `${JSON.stringify({ type: 'file-history-snapshot', messageId: randomUUID(), snapshot: {}, isSnapshotUpdate: false })}\n`)
    await same('hidden transcript created')
    await settle()
    const hiddenBefore = derives
    appendFileSync(transcriptPath(configDir, hidden), `${JSON.stringify({ type: 'file-history-snapshot', messageId: randomUUID(), snapshot: {}, isSnapshotUpdate: true })}\n`)
    await same('hidden transcript written, still hidden')
    assert.equal(derives, hiddenBefore, 'a write to a transcript the list drops re-derived the page')
    await settle()
    appendFileSync(transcriptPath(configDir, hidden), `${JSON.stringify(line(hidden, null, 'user', 'now it has a prompt', new Date()))}\n`)
    const entered = await same('hidden transcript gained a prompt')
    assert.equal(derives, hiddenBefore + 1, 'a hidden transcript that became listable was patched around')
    assert.ok(entered.some((session) => session.sessionId === hidden), 'a transcript that became listable never entered the page')

    // One added and one removed between two sweeps: the corpus is the same size.
    await settle()
    const swapBefore = derives
    rmSync(transcriptPath(configDir, ids[4]))
    const swapped = writeSession(configDir, 'swapped in', 0)
    const afterSwap = await same('one added, one removed')
    assert.equal(derives, swapBefore + 1, 'a same-size swap of transcripts was patched')
    assert.ok(afterSwap.some((session) => session.sessionId === swapped))

    // The adapter itself serves the same page, decorated.
    const listed = await claudeAdapter.listSessions!({ limit: 50, offset: 0 })
    assert.deepEqual(listed.map((session) => session.sessionId), (await truth()).map((session) => session.sessionId))
    assert.ok(listed.every((session) => session.provider === 'claude' && session.capabilities))
  } else {
    // The previous process's snapshot, patched with the turn written between.
    const patched = await same('restart')
    assert.equal(derives, 0, 'a restarted process re-derived the page instead of patching its snapshot')
    assert.equal(patched[0]?.sessionId, ids[0])
  }
  process.exit(0)
}
