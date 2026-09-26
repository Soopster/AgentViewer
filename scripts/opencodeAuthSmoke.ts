import assert from 'node:assert/strict'

const username = 'custom-user'
const password = 'local-smoke-password'
const expectedAuthorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
const observedPaths: string[] = []
const originalFetch = globalThis.fetch
process.env.OPENCODE_BASE_URL = 'http://127.0.0.1:41029'
process.env.OPENCODE_SERVER_USERNAME = username
process.env.OPENCODE_SERVER_PASSWORD = password
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  assert.equal(request.headers.get('authorization'), expectedAuthorization)
  observedPaths.push(url.pathname)
  if (url.pathname === '/session') {
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  // A v1 server serves its web app at the v2 probe path.
  return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
}
try {
  const { getOpenCodeClient } = await import('../lib/opencodeClient')
  const client = await getOpenCodeClient()
  const result = await client.session.list()
  assert.deepEqual(result.data, [])
  assert.ok(observedPaths.includes('/api/info'), 'the v2 probe must authenticate')
  assert.ok(observedPaths.filter((path) => path === '/session').length >= 2, 'probe and SDK call must authenticate')
  console.log('opencode custom Basic auth smoke passed')
} finally {
  globalThis.fetch = originalFetch
}
