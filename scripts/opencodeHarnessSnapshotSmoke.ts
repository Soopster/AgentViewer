import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const streams = new Set<http.ServerResponse>()
const json = (response: http.ServerResponse, value: unknown) => {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/session') return json(response, [])
  if (url.pathname === '/session/status') {
    return json(response, {
      'session-a': { type: 'retry', attempt: 2, message: 'retrying', next: 10 },
    })
  }
  if (url.pathname === '/session/session-a/todo') {
    return json(response, [{ id: 'todo', content: 'Verify', status: 'pending', priority: 'high' }])
  }
  if (url.pathname === '/permission') {
    return json(response, [{
      id: 'permission',
      sessionID: 'session-a',
      permission: 'bash',
      patterns: ['npm test'],
      always: ['npm *'],
      metadata: { command: 'npm test' },
    }])
  }
  if (url.pathname === '/question') {
    return json(response, [{
      id: 'question',
      sessionID: 'session-a',
      questions: [{ question: 'Continue?', header: 'Confirm', options: [] }],
    }])
  }
  if (url.pathname === '/global/event') {
    streams.add(response)
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    response.write(`data: ${JSON.stringify({
      directory: 'global',
      payload: { type: 'server.connected', properties: {} },
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
const subscription = subscribeToOpenCodeEvents({ sessionId: 'session-a', directory: '/repo-a' })
const iterator = subscription.events[Symbol.asyncIterator]()
let snapshot
while (!snapshot) {
  const result = await Promise.race([
    iterator.next(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for OpenCode snapshot')), 2_000)),
  ])
  if (result.done) break
  if (result.value.type === 'snapshot') snapshot = result.value.snapshot
}

assert(snapshot, 'late subscriber should receive a hydrated snapshot')
assert.equal(snapshot.status?.type, 'retry')
assert.equal(snapshot.todos?.[0]?.id, 'todo')
assert.equal(snapshot.permissions[0]?.id, 'permission')
assert.equal(snapshot.permissions[0]?.type, 'bash')
assert.equal(snapshot.questions[0]?.id, 'question')

subscription.close()
for (const stream of streams) stream.end()
server.closeAllConnections()
await new Promise<void>((resolve) => server.close(() => resolve()))

console.log('opencode harness snapshot smoke passed')
process.exit(0)
