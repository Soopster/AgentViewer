import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import {
  createPiAgentSession,
  evictPiAgentSession,
  getPiSessionMessages,
  listPiSessions,
  openPiAgentSession,
} from '../lib/piClient'

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const startedAt = performance.now()
  const value = await run()
  return { value, ms: performance.now() - startedAt }
}

const coldList = await timed(() => listPiSessions())
const cachedList = await timed(() => listPiSessions())
assert.strictEqual(cachedList.value, coldList.value)

await new Promise((resolve) => setTimeout(resolve, 1_025))
const coalesced = await timed(() => Promise.all(
  Array.from({ length: 20 }, () => listPiSessions()),
))
assert.ok(coalesced.value.every((sessions) => sessions === coalesced.value[0]))

const sessionRoot = await mkdtemp(join(tmpdir(), 'agent-viewer-pi-perf-'))
const previousSessionDir = process.env.PI_SESSION_DIR
const previousDisableSessionIndex = process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX
const sessionId = randomUUID()

try {
  process.env.PI_SESSION_DIR = sessionRoot
  const transcriptId = randomUUID()
  const timestamp = '2026-08-21T00:00:00.000Z'
  const transcriptEntries: object[] = [
    { type: 'session', version: 3, id: transcriptId, timestamp, cwd: sessionRoot },
  ]
  for (let index = 0; index < 5_000; index += 1) {
    transcriptEntries.push({
      type: 'message',
      id: `message-${index}`,
      parentId: index === 0 ? null : `message-${index - 1}`,
      timestamp,
      message: { role: 'user', content: `message ${index}`, timestamp: Date.parse(timestamp) + index },
    })
  }
  await writeFile(
    join(sessionRoot, `2026-08-21T00-00-00-000Z_${transcriptId}.jsonl`),
    `${transcriptEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
  )
  const coldTranscript = await timed(() => getPiSessionMessages(transcriptId))
  const cachedTranscript = await timed(() => getPiSessionMessages(transcriptId))
  assert.equal(coldTranscript.value.length, 5_000)
  assert.strictEqual(cachedTranscript.value[0], coldTranscript.value[0])

  process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX = '1'
  const { listViewSessionMessageWindow } = await import('../lib/sessionBackend')
  const mappedWindow = await timed(() => listViewSessionMessageWindow(
    transcriptId,
    { offset: 0, limit: 5_000 },
    'pi',
  ))
  const hotWindow = await timed(() => listViewSessionMessageWindow(
    transcriptId,
    { offset: 0, limit: 5_000 },
    'pi',
  ))
  assert.equal(mappedWindow.value.messages.length, 5_000)
  assert.strictEqual(hotWindow.value.messages[0], mappedWindow.value.messages[0])

  const coldSession = await timed(() => createPiAgentSession(sessionRoot, { id: sessionId }))
  const warmSession = await timed(() => openPiAgentSession(sessionId))
  assert.strictEqual(warmSession.value, coldSession.value)

  const metrics = {
    sessions: coldList.value.length,
    coldListMs: Number(coldList.ms.toFixed(3)),
    cachedListMs: Number(cachedList.ms.toFixed(3)),
    coalescedList20Ms: Number(coalesced.ms.toFixed(3)),
    coldTranscript5000Ms: Number(coldTranscript.ms.toFixed(3)),
    cachedTranscript5000Ms: Number(cachedTranscript.ms.toFixed(3)),
    mappedWindow5000Ms: Number(mappedWindow.ms.toFixed(3)),
    hotWindow5000Ms: Number(hotWindow.ms.toFixed(3)),
    coldSessionMs: Number(coldSession.ms.toFixed(3)),
    warmSessionMs: Number(warmSession.ms.toFixed(3)),
  }

  // These budgets cover process-local paths only. Cold SDK/resource discovery
  // is reported but intentionally not gated because extension/package setup is
  // machine-dependent.
  assert.ok(metrics.cachedListMs < 10, `cached Pi list exceeded 10ms: ${metrics.cachedListMs}ms`)
  assert.ok(
    metrics.cachedTranscript5000Ms < 10,
    `cached 5000-message Pi transcript exceeded 10ms: ${metrics.cachedTranscript5000Ms}ms`,
  )
  assert.ok(metrics.warmSessionMs < 10, `warm Pi session open exceeded 10ms: ${metrics.warmSessionMs}ms`)
  assert.ok(metrics.hotWindow5000Ms < 10, `hot 5000-message Pi window exceeded 10ms: ${metrics.hotWindow5000Ms}ms`)
  console.log(JSON.stringify(metrics, null, 2))
} finally {
  await evictPiAgentSession(sessionId)
  if (previousSessionDir === undefined) delete process.env.PI_SESSION_DIR
  else process.env.PI_SESSION_DIR = previousSessionDir
  if (previousDisableSessionIndex === undefined) delete process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX
  else process.env.AGENT_VIEWER_DISABLE_SESSION_INDEX = previousDisableSessionIndex
  await rm(sessionRoot, { recursive: true, force: true })
}
