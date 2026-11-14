import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

// The route captures cwd at module initialization. Keep real user history out
// of the fixture and import only after entering the isolated directory.
const previousCwd = process.cwd()
const fixtureCwd = await mkdtemp(path.join(tmpdir(), 'agent-viewer-bridge-history-'))
const sessionId = 'same-native-session'
const timestamp = '2026-11-13T00:00:00.000Z'
const legacy = { provider: 'claude', sessionId, kind: 'reply', text: 'legacy default history', timestamp }
try {
  const dataDir = path.join(fixtureCwd, '.agent-viewer-data')
  await mkdir(dataDir)
  const historyFile = path.join(dataDir, 'bridge-messages.json')
  await writeFile(historyFile, JSON.stringify({ [`claude::${sessionId}`]: [legacy] }))
  process.chdir(fixtureCwd)
  const route = await import('../app/api/bridge-messages/route')
  type Message = typeof legacy & { providerInstanceId?: string }
  async function get(instance?: string, nativeId = sessionId, includeProvider = true): Promise<Message[]> {
    const query = new URLSearchParams({ sessionId: nativeId })
    if (includeProvider) query.set('provider', 'claude')
    if (instance !== undefined) query.set('providerInstanceId', instance)
    const response = await route.GET(new NextRequest(`http://localhost/api/bridge-messages?${query}`))
    assert.equal(response.status, 200)
    const data = await response.json() as { messages: Message[] }
    return data.messages
  }
  async function post(text: string, instance?: string, kind: 'sent' | 'reply' = 'sent', nativeId = sessionId) {
    const response = await route.POST(new NextRequest('http://localhost/api/bridge-messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', sessionId: nativeId, providerInstanceId: instance, kind, text, timestamp }),
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { success: true })
  }

  assert.deepEqual(await get(), [legacy])
  assert.deepEqual(await get(undefined, sessionId, false), [legacy], 'omitting the provider still reads default Claude history')
  assert.deepEqual(await get('claude'), [legacy], 'explicit default instance retains the legacy key')
  assert.deepEqual(await get('personal'), [], 'configured accounts cannot inherit legacy default history')
  assert.deepEqual(await get('work'), [])

  await post('personal sent', 'personal')
  await post('work reply', 'work', 'reply')
  await post('personal reply', 'personal', 'reply')
  await post('other native session', 'personal', 'sent', 'other-native-session')
  assert.deepEqual((await get('personal')).map(message => [message.kind, message.text, message.providerInstanceId]), [
    ['sent', 'personal sent', 'personal'], ['reply', 'personal reply', 'personal'],
  ])
  assert.deepEqual((await get('work')).map(message => [message.kind, message.text, message.providerInstanceId]), [
    ['reply', 'work reply', 'work'],
  ])
  assert.deepEqual((await get('personal', 'other-native-session')).map(message => message.text), ['other native session'])
  assert.deepEqual(await get(), [legacy], 'configured-account writes cannot modify default history')

  await post('new default sent')
  await post('explicit default reply', 'claude', 'reply')
  const defaultTexts = ['legacy default history', 'new default sent', 'explicit default reply']
  assert.deepEqual((await get()).map(message => message.text), defaultTexts)
  assert.deepEqual((await get('claude')).map(message => message.text), defaultTexts)
  assert.deepEqual((await get('personal')).map(message => message.text), ['personal sent', 'personal reply'])
  assert.deepEqual((await get('work')).map(message => message.text), ['work reply'])

  const concurrentCount = 24
  const appends = Promise.all(Array.from({ length: concurrentCount }, (_, index) => Promise.all([
    post(`personal concurrent ${index}`, 'personal'),
    post(`work concurrent ${index}`, 'work'),
  ])))
  // Read during replacement: every snapshot must still contain complete baseline rows.
  for (let index = 0; index < 12; index += 1) {
    const [personal, work] = await Promise.all([get('personal'), get('work')])
    assert.deepEqual(personal.slice(0, 2).map(message => message.text), ['personal sent', 'personal reply'])
    assert.equal(work[0]?.text, 'work reply')
    assert.ok(personal.every(message => message.providerInstanceId === 'personal'))
    assert.ok(work.every(message => message.providerInstanceId === 'work'))
  }
  await appends
  const personal = await get('personal')
  const work = await get('work')
  assert.equal(personal.length, concurrentCount + 2, 'all concurrent personal appends survive')
  assert.equal(work.length, concurrentCount + 1, 'all concurrent work appends survive')
  for (let index = 0; index < concurrentCount; index += 1) {
    assert.equal(personal.filter(message => message.text === `personal concurrent ${index}`).length, 1)
    assert.equal(work.filter(message => message.text === `work concurrent ${index}`).length, 1)
  }
  assert.deepEqual((await get()).map(message => message.text), defaultTexts)

  // Force the atomic rename to fail, then verify the queue accepts later writes.
  const backupFile = `${historyFile}.backup`
  await rename(historyFile, backupFile)
  await mkdir(historyFile)
  const originalError = console.error
  const errors: unknown[][] = []
  try {
    console.error = (...args: unknown[]) => { errors.push(args) }
    const failed = await route.POST(new NextRequest('http://localhost/api/bridge-messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', sessionId, providerInstanceId: 'personal', kind: 'sent', text: 'must fail' }),
    }))
    assert.equal(failed.status, 500, 'failed persistence cannot report a saved message')
    assert.deepEqual(await failed.json(), { error: 'Failed to save bridge messages' })
    assert.equal(errors.length, 1, 'the persistence failure is logged')
  } finally {
    console.error = originalError
    await rm(historyFile, { recursive: true, force: true })
    await rename(backupFile, historyFile)
  }
  await post('personal after failure', 'personal')
  assert.deepEqual((await get('personal')).map(message => message.text), [...personal.map(message => message.text), 'personal after failure'])
  assert.deepEqual(await get('work'), work)
  assert.ok(!(await readdir(dataDir)).some(name => name.endsWith('.tmp')), 'atomic write temporary files are cleaned up')

  const stored = JSON.parse(await readFile(historyFile, 'utf8')) as Record<string, Message[]>
  assert.deepEqual(Object.keys(stored).sort(), [
    `claude::${sessionId}`, `claude@personal:${sessionId}`, `claude@work:${sessionId}`, 'claude@personal:other-native-session',
  ].sort(), 'default storage remains backward-compatible while configured owners get separate keys')
  assert.equal(stored[`claude::${sessionId}`][0].providerInstanceId, undefined, 'the legacy row is preserved without migration')
  const missing = await route.GET(new NextRequest('http://localhost/api/bridge-messages?provider=claude'))
  assert.equal(missing.status, 400)
  const unsupported = await route.GET(new NextRequest(`http://localhost/api/bridge-messages?provider=codex&sessionId=${sessionId}`))
  assert.equal(unsupported.status, 400)
  console.log('Bridge history identity: PASS (account/legacy isolation, concurrent appends, complete read snapshots, persistence failure and queue recovery)')
} finally {
  process.chdir(previousCwd)
  await rm(fixtureCwd, { recursive: true, force: true })
}
