import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

let messageReads = 0
let eventStream: http.ServerResponse | undefined
let messagesResponse: unknown[] = []
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/session') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('[]')
    return
  }
  if (url.pathname === '/session/session/message') {
    messageReads += 1
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(messagesResponse))
    return
  }
  if (url.pathname === '/global/event') {
    eventStream = response
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

const harness = await import('../lib/opencodeHarness')
harness.ensureOpenCodeEventsStarted()
for (let attempt = 0; attempt < 200 && !harness.getOpenCodeTranscriptCacheVersion('session'); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5))
}
assert(harness.getOpenCodeTranscriptCacheVersion('session'), 'event stream should connect before cache test')

const { listViewSessionMessages } = await import('../lib/sessionBackend')
await listViewSessionMessages('session', { limit: 100, offset: 0 }, 'opencode')
await listViewSessionMessages('session', { limit: 100, offset: 0 }, 'opencode')
assert.equal(messageReads, 1, 'unchanged transcript poll should reuse the event-versioned cache')

// Reproduce the new-session race: the initial empty transcript is cached, the
// first composer message persists, but its event is missed while the shared
// SSE transport is starting/reconnecting. The verification backstop must
// still discover the new row instead of trusting the empty cache forever.
messagesResponse = [{
  info: {
    id: 'user-message',
    sessionID: 'session',
    role: 'user',
    time: { created: 1 },
  },
  parts: [{
    id: 'user-part',
    sessionID: 'session',
    messageID: 'user-message',
    type: 'text',
    text: 'first composer message',
  }],
}]
await new Promise((resolve) => setTimeout(resolve, 1_050))
const recovered = await listViewSessionMessages('session', { limit: 100, offset: 0 }, 'opencode')
assert.equal(messageReads, 2, 'event cache should be verified against OpenCode after its bounded TTL')
assert.equal(recovered.length, 1, 'a missed first-message event must not leave the transcript empty')

const previousVersion = harness.getOpenCodeTranscriptCacheVersion('session')
eventStream?.write(`data: ${JSON.stringify({
  directory: '/repo',
  payload: {
    type: 'message.part.delta',
    properties: {
      sessionID: 'session',
      messageID: 'message',
      partID: 'part',
      field: 'text',
      delta: 'changed',
    },
  },
})}\n\n`)
for (let attempt = 0; attempt < 200 && harness.getOpenCodeTranscriptCacheVersion('session') === previousVersion; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5))
}
assert.notEqual(harness.getOpenCodeTranscriptCacheVersion('session'), previousVersion)

await listViewSessionMessages('session', { limit: 100, offset: 0 }, 'opencode')
assert.equal(messageReads, 3, 'message event should invalidate the zero-RPC poll cache')

eventStream?.end()
server.closeAllConnections()
await new Promise<void>((resolve) => server.close(() => resolve()))
console.log('opencode message cache smoke passed')
process.exit(0)
