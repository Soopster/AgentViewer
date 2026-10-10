// The Coordinator change stream (/api/agent-protocol/runs/changes). Every run
// change and heartbeat is queued for every subscriber, so a client that stops
// reading and never disconnects — a suspended laptop, a wedged tab — grew this
// stream's buffer for the life of the process. Herdr drops an observer that
// makes no write progress (#3612); the pane keeps running, only the observer
// goes. A stalled reader is invisible in every frame, so it is pinned here.
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.AGENT_VIEWER_SSE_STALL_MS = '300'
process.chdir(mkdtempSync(path.join(tmpdir(), 'coord-changes-')))
const { GET } = await import('../app/api/agent-protocol/runs/changes/route')
const { notifyRunChangedForSmoke } = await import('../lib/agentCoordination') as unknown as { notifyRunChangedForSmoke: (runId: string) => void }

async function openStream() {
  const controller = new AbortController()
  const response = await GET(new Request('http://localhost/api/agent-protocol/runs/changes', { signal: controller.signal }) as never)
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream; charset=utf-8')
  return { reader: response.body!.getReader(), controller }
}
const decoder = new TextDecoder()

// A reader that drains keeps its subscription, however many changes arrive.
{
  const { reader, controller } = await openStream()
  assert.match(decoder.decode((await reader.read()).value), /: connected/)
  for (let index = 0; index < 50; index += 1) {
    notifyRunChangedForSmoke(`run-${index}`)
    const chunk = await reader.read()
    assert.equal(chunk.done, false, 'a draining reader is never dropped')
  }
  await new Promise(resolve => setTimeout(resolve, 400))
  notifyRunChangedForSmoke('run-final')
  const last = await reader.read()
  assert.equal(last.done, false, 'time alone does not drop a reader that is keeping up')
  controller.abort()
}

// A reader that stops draining is dropped once it has made no progress. The
// stream closes with its queue intact — a closed ReadableStream still hands
// over what it already buffered — so the drop shows up as the reader reaching
// `done` after draining, without anything cancelling it.
{
  const { reader } = await openStream()
  await reader.read() // ": connected", then nothing for longer than the window.
  for (let index = 0; index < 40; index += 1) {
    notifyRunChangedForSmoke(`stalled-${index}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  let done = false
  for (let reads = 0; reads < 200 && !done; reads += 1) done = (await reader.read()).done
  assert.equal(done, true, 'the stalled subscriber was never dropped')
}

console.log('Coordinator change stream: a draining subscriber is kept, a stalled one is dropped')
process.exit(0)
