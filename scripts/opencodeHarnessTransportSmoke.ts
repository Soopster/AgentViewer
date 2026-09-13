import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

let globalConnections = 0
const openStreams = new Set<http.ServerResponse>()

const server = http.createServer((request, response) => {
  if (request.url === '/session') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('[]')
    return
  }

  if (request.url === '/global/event') {
    globalConnections += 1
    openStreams.add(response)
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    response.write(`data: ${JSON.stringify({
      directory: '/repo-a',
      payload: {
        type: 'session.status',
        properties: { sessionID: 'session-a', status: { type: 'busy' } },
      },
    })}\n\n`)
    response.write(`data: ${JSON.stringify({
      directory: '/repo-b',
      payload: {
        type: 'session.status',
        properties: { sessionID: 'session-b', status: { type: 'busy' } },
      },
    })}\n\n`)
    return
  }

  response.writeHead(404)
  response.end()
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address() as AddressInfo
process.env.OPENCODE_BASE_URL = `http://127.0.0.1:${address.port}`

const { subscribeToOpenCodeEvents } = await import('../lib/opencodeHarness')
const first = subscribeToOpenCodeEvents({ sessionId: 'session-a', directory: '/repo-a' })
const second = subscribeToOpenCodeEvents({ sessionId: 'session-b', directory: '/repo-b' })

async function nextProviderEvent(subscription: typeof first) {
  const iterator = subscription.events[Symbol.asyncIterator]()
  while (true) {
    const result = await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for routed OpenCode event')), 2_000)),
    ])
    if (result.done) break
    const event = result.value
    if (event.type === 'event') return event
  }
  throw new Error('Timed out waiting for routed OpenCode event')
}

const [eventA, eventB] = await Promise.all([
  nextProviderEvent(first),
  nextProviderEvent(second),
])

assert.equal(globalConnections, 1, 'all directories should share one upstream global SSE connection')
assert.equal(eventA.sessionId, 'session-a')
assert.equal(eventB.sessionId, 'session-b')

first.close()
second.close()
for (const stream of openStreams) stream.end()
server.closeAllConnections()
await new Promise<void>((resolve) => server.close(() => resolve()))

console.log('opencode harness transport smoke passed')
process.exit(0)
