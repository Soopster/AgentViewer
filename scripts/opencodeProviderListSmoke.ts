import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const requestedLimits: string[] = []
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/session') {
    const limit = url.searchParams.get('limit')
    if (limit) requestedLimits.push(limit)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('[]')
    return
  }
  response.writeHead(404)
  response.end()
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address() as AddressInfo
process.env.OPENCODE_BASE_URL = `http://127.0.0.1:${address.port}`

const { listViewSessions } = await import('../lib/sessionBackend')
const sessions = await listViewSessions({ provider: 'opencode', limit: 500, offset: 0 })
assert.deepEqual(sessions, [])
assert.deepEqual(requestedLimits, ['500'], 'OpenCode list request should carry the requested page prefix')

server.closeAllConnections()
await new Promise<void>((resolve) => server.close(() => resolve()))
console.log('opencode provider list smoke passed')
