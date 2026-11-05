// A second account's sessions are listed beside the first's, read from their
// own store, and never cost the first account a read.
//
// Run with bun. Two Claude config directories, each holding hand-written
// transcripts: the process's own (the default instance) and a configured
// instance's. No Claude process is started; these are store reads only.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function writeSession(configDir: string, label: string): string {
  const sessionId = randomUUID()
  const project = path.join(configDir, 'projects', '-tmp-instance-smoke')
  mkdirSync(project, { recursive: true })
  const base = { isSidechain: false, sessionId, cwd: '/tmp/instance-smoke', userType: 'external', version: '2.1.0' }
  const user = { ...base, parentUuid: null, type: 'user', uuid: randomUUID(), timestamp: new Date().toISOString(), message: { role: 'user', content: `prompt in ${label}` } }
  const reply = { ...base, parentUuid: user.uuid, type: 'assistant', uuid: randomUUID(), timestamp: new Date().toISOString(), message: { id: `msg_${sessionId}`, type: 'message', role: 'assistant', model: 'smoke', content: [{ type: 'text', text: `reply in ${label}` }] } }
  writeFileSync(path.join(project, `${sessionId}.jsonl`), `${JSON.stringify(user)}\n${JSON.stringify(reply)}\n`)
  return sessionId
}

if (process.argv[2] !== 'child') {
  const dir = mkdtempSync(path.join(tmpdir(), 'provider-instances-'))
  const personal = path.join(dir, 'personal')
  const work = path.join(dir, 'work')
  const personalIds = Array.from({ length: 40 }, (_, index) => writeSession(personal, `personal ${index}`))
  const workId = writeSession(work, 'work')
  mkdirSync(path.join(dir, '.agent-viewer-data'), { recursive: true })
  writeFileSync(path.join(dir, '.agent-viewer-data', 'provider-instances.json'), JSON.stringify({
    version: 1, instances: [{ id: 'work', provider: 'claude', displayName: 'Work', environment: { CLAUDE_CONFIG_DIR: work } }],
  }))
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child', dir, workId, ...personalIds], {
    stdio: 'inherit', env: { ...process.env, CLAUDE_CONFIG_DIR: personal }, timeout: 60_000,
  })
  assert.equal(child.status, 0, 'provider instance reads smoke child failed')
  console.log('Provider instance reads smoke passed (a provider lists every instance, a picked one only its own; a session is read from the store that listed it; reads for two accounts never cross)')
} else {
  const [dir, workId, ...personalIds] = process.argv.slice(3) as [string, string, ...string[]]
  process.chdir(dir)
  const tui = await import('../lib/tui/reads')
  const view = await import('../lib/sessionReads')
  const instances = await import('../lib/providerInstances')
  const text = (messages: unknown) => JSON.stringify(messages)

  // Named only by provider and id, before anything has listed it: the default
  // account has no such session. (This is what the TUI used to always get.)
  assert.equal(await view.readViewSessionInfo(workId, 'claude'), null)

  // The bare provider is every instance, each row under its own.
  const all = await tui.readTuiSessions('claude')
  assert.equal(all.length, personalIds.length + 1, 'the provider did not list both accounts')
  assert.deepEqual(all.filter((session) => session.sessionId === workId).map((session) => [session.providerInstanceId, session.providerDisplayName]), [['work', 'Work']])
  assert.ok(all.filter((session) => session.sessionId !== workId).every((session) => session.providerInstanceId === 'claude'))
  // A picked instance is only its own.
  assert.deepEqual((await tui.readTuiSessions('claude', 'work')).map((session) => session.sessionId), [workId])
  assert.equal((await tui.readTuiSessions('claude', 'claude')).length, personalIds.length)

  // Listed, it is read from its own store by a caller that still names no instance.
  const routed = await tui.readTuiSessionDetailSource({ sessionId: workId, provider: 'claude' } as never)
  assert.ok(text(routed.rawMessages).includes('reply in work'), 'a second account\'s session was not read from its own store')
  assert.equal(routed.info?.sessionId, workId)
  // And through the adapter directly, under the named instance: the store read
  // itself has to run in that instance's environment, not just the listing.
  const named = await instances.withProviderInstance('work', 'claude', () => view.listViewSessionMessageWindow(workId, { limit: 10, offset: 0 }, 'claude'))
  assert.ok(text(named.messages).includes('reply in work'))

  // Reading one account must not cost the other a read. A second account's
  // read swaps process.env for its duration; a first-account read starting
  // inside that window would look in the wrong store and find nothing.
  const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const found = await Promise.all(personalIds.flatMap((sessionId, index) => [
    later(index).then(() => view.readViewSessionInfo(workId, 'claude')).then((info) => info?.sessionId === workId),
    later(index + 0.5).then(() => view.readViewSessionInfo(sessionId, 'claude')).then((info) => info?.sessionId === sessionId),
  ]))
  assert.equal(found.filter((ok) => !ok).length, 0, 'reads for two accounts crossed stores')
  process.exit(0)
}
