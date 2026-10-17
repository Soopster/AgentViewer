import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'
import {
  ClaudeSqliteSessionStore,
  claudeSessionPersistenceQueryOptions,
} from '../lib/claudeSessionStore'
import {
  claudeProcessSpawnOptions,
  registerClaudeProcessSpawner,
} from '../lib/claudeProcessSpawner'

const temp = await mkdtemp(join(tmpdir(), 'agent-viewer-claude-store-'))
try {
  const store = new ClaudeSqliteSessionStore(join(temp, 'sessions.sqlite'))
  const key = { projectKey: 'project-a', sessionId: 'session-a' }
  await store.append(key, [
    { type: 'user', uuid: 'stable-1', timestamp: '2026-08-12T00:00:00.000Z', body: 'first' },
    { type: 'custom-title', title: 'One' },
  ])
  await store.append(key, [
    { type: 'user', uuid: 'stable-1', timestamp: '2026-08-12T00:00:00.000Z', body: 'retry' },
    { type: 'custom-title', title: 'Two' },
  ])
  assert.deepEqual(await store.load(key), [
    { type: 'user', uuid: 'stable-1', timestamp: '2026-08-12T00:00:00.000Z', body: 'first' },
    { type: 'custom-title', title: 'One' },
    { type: 'custom-title', title: 'Two' },
  ], 'stable UUID retries should deduplicate while UUID-less entries append')

  const subkey = { ...key, subpath: 'subagents/agent-child' }
  await store.append(subkey, [{ type: 'assistant', uuid: 'child-1', body: 'child' }])
  assert.deepEqual(await store.listSubkeys(key), ['subagents/agent-child'])
  assert.deepEqual((await store.listSessions('project-a')).map((item) => item.sessionId), ['session-a'])
  await store.delete(key)
  assert.equal(await store.load(key), null)
  assert.equal(await store.load(subkey), null, 'main deletion should include subagent transcripts')
  assert.deepEqual(await store.listSessions('project-a'), [])

  const previousMode = process.env.AGENT_VIEWER_CLAUDE_SESSION_STORE
  const previousPath = process.env.AGENT_VIEWER_CLAUDE_SESSION_STORE_PATH
  process.env.AGENT_VIEWER_CLAUDE_SESSION_STORE = 'sqlite'
  process.env.AGENT_VIEWER_CLAUDE_SESSION_STORE_PATH = join(temp, 'configured.sqlite')
  const persistence = claudeSessionPersistenceQueryOptions()
  assert.ok(persistence.sessionStore)
  assert.equal(persistence.enableFileCheckpointing, false,
    'SDK forbids file checkpointing with a session store')
  if (previousMode === undefined) delete process.env.AGENT_VIEWER_CLAUDE_SESSION_STORE
  else process.env.AGENT_VIEWER_CLAUDE_SESSION_STORE = previousMode
  if (previousPath === undefined) delete process.env.AGENT_VIEWER_CLAUDE_SESSION_STORE_PATH
  else process.env.AGENT_VIEWER_CLAUDE_SESSION_STORE_PATH = previousPath

  const events = new EventEmitter()
  const fakeProcess = {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    killed: false,
    exitCode: null,
    signalCode: null,
    kill: () => true,
    on: events.on.bind(events),
    once: events.once.bind(events),
    off: events.off.bind(events),
  } as unknown as SpawnedProcess
  let receivedSignal: AbortSignal | null = null
  const unregister = registerClaudeProcessSpawner((options) => {
    receivedSignal = options.signal
    return fakeProcess
  })
  const spawn = claudeProcessSpawnOptions().spawnClaudeCodeProcess
  assert.ok(spawn)
  const controller = new AbortController()
  assert.equal(spawn?.({ command: 'claude', args: [], env: {}, signal: controller.signal }), fakeProcess)
  assert.equal(receivedSignal, controller.signal, 'the SDK grace-period signal must reach the adapter unchanged')
  unregister()
  assert.equal(claudeProcessSpawnOptions().spawnClaudeCodeProcess, undefined)

  console.log('claude session-store/process-spawner smoke passed')
} finally {
  await rm(temp, { recursive: true, force: true })
}
