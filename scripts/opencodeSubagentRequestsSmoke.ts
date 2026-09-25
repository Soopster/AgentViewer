// Hermetic half of opencodeSubagentPermissionSmoke.ts: a subagent's asks come
// from its child session, and the harness must deliver them to every ancestor's
// subscriber and snapshot — and nothing else of the child's.
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const streams = new Set<http.ServerResponse>()
const json = (response: http.ServerResponse, value: unknown) => {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}
const sessions: Record<string, { id: string; parentID?: string }> = {
  'child-b': { id: 'child-b', parentID: 'session-a' },
  'other-c': { id: 'other-c' },
  // Only reachable by lookup: no session.created is ever sent for it.
  'grandchild-d': { id: 'grandchild-d', parentID: 'child-live' },
}
const permission = (id: string, sessionID: string) => ({ id, sessionID, permission: 'bash', patterns: ['echo hi'], always: [], metadata: {} })

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const sessionMatch = url.pathname.match(/^\/session\/([^/]+)$/)
  if (sessionMatch && sessions[sessionMatch[1]!]) return json(response, sessions[sessionMatch[1]!])
  if (url.pathname === '/session') return json(response, [])
  if (url.pathname === '/session/status') return json(response, {})
  if (/^\/session\/[^/]+\/todo$/.test(url.pathname)) return json(response, [])
  if (url.pathname === '/permission') return json(response, [permission('perm-child', 'child-b'), permission('perm-other', 'other-c')])
  if (url.pathname === '/question') return json(response, [])
  if (url.pathname === '/global/event') {
    streams.add(response)
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    response.write(`data: ${JSON.stringify({ directory: 'global', payload: { type: 'server.connected', properties: {} } })}\n\n`)
    return
  }
  response.writeHead(404)
  response.end()
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
process.env.OPENCODE_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const emit = (type: string, properties: Record<string, unknown>) => {
  for (const stream of streams) stream.write(`data: ${JSON.stringify({ directory: '/repo-a', payload: { type, properties } })}\n\n`)
}

const { subscribeToOpenCodeEvents, getOpenCodeSessionSnapshot } = await import('../lib/opencodeHarness')
const subscription = subscribeToOpenCodeEvents({ sessionId: 'session-a', directory: '/repo-a' })
const iterator = subscription.events[Symbol.asyncIterator]()
const received: Array<{ type: string; sessionID?: string; id?: string }> = []
let snapshot: { permissions: Array<{ id: string; sessionID: string }> } | undefined
const pump = (async () => {
  for (;;) {
    const result = await iterator.next()
    if (result.done) return
    const value = result.value
    if (value.type === 'snapshot') snapshot = value.snapshot as typeof snapshot
    if (value.type === 'event') {
      const props = (value.event as { properties?: Record<string, unknown> }).properties ?? {}
      const part = props.part as { sessionID?: string } | undefined
      received.push({ type: value.event.type, sessionID: (props.sessionID as string | undefined) ?? part?.sessionID, id: props.id as string | undefined })
    }
  }
})()
async function until(check: () => boolean, what: string) {
  const deadline = Date.now() + 3_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}\nreceived: ${JSON.stringify(received)}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

// Hydration: a descendant's pending ask belongs to the chat; an unrelated session's does not.
await until(() => Boolean(snapshot), 'hydrated snapshot')
assert.deepEqual(snapshot!.permissions.map((entry) => entry.id), ['perm-child'], 'hydration must include the child\'s ask and only it')

await until(() => streams.size > 0, 'event stream connected')
emit('session.created', { info: { id: 'child-live', parentID: 'session-a', title: 'subagent' } })
emit('message.part.updated', { part: { id: 'part-1', sessionID: 'child-live', messageID: 'm1', type: 'text', text: 'child prose' } })
emit('permission.asked', permission('perm-live', 'child-live'))
await until(() => received.some((event) => event.id === 'perm-live'), 'a live child ask forwarded to the chat')
// A grandchild the harness has never seen: its parent is looked up, then it is delivered.
emit('permission.asked', permission('perm-late', 'grandchild-d'))
await until(() => received.some((event) => event.id === 'perm-late'), 'a grandchild ask forwarded after an ancestry lookup')

assert.ok(!received.some((event) => event.type === 'message.part.updated'), 'a child\'s own messages must not enter the chat\'s stream')
const mirrored = getOpenCodeSessionSnapshot('session-a')?.permissions.map((entry) => `${entry.id}@${entry.sessionID}`).sort()
assert.deepEqual(mirrored, ['perm-child@child-b', 'perm-late@grandchild-d', 'perm-live@child-live'],
  'the chat\'s snapshot must hold every pending descendant ask, keyed by the session that asked')

// Answered in the child, cleared in the chat.
emit('permission.replied', { sessionID: 'child-live', requestID: 'perm-live', reply: 'once' })
await until(() => !getOpenCodeSessionSnapshot('session-a')?.permissions.some((entry) => entry.id === 'perm-live'), 'a reply clears the mirrored ask')
// A deleted child's asks can never be answered.
emit('session.deleted', { info: { id: 'grandchild-d', parentID: 'child-live' } })
await until(() => !getOpenCodeSessionSnapshot('session-a')?.permissions.some((entry) => entry.id === 'perm-late'), 'a deleted child\'s ask is dropped')

subscription.close()
void pump
for (const stream of streams) stream.end()
server.close()
console.log('opencode subagent requests smoke passed')
process.exit(0)
