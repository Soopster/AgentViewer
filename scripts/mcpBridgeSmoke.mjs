import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const seen = []
const daemon = createServer(async (request, response) => {
  const body = await new Promise((resolve) => {
    let value = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { value += chunk })
    request.on('end', () => resolve(value ? JSON.parse(value) : null))
  })
  seen.push({ method: request.method, url: request.url, body })
  response.setHeader('Content-Type', 'application/json')

  if (request.url?.startsWith('/api/session-index/search?')) {
    response.end(JSON.stringify({
      total: 1,
      results: [{
        session: { provider: 'claude', sessionId: 'session-1', title: 'Bridge smoke', cwd: '/tmp/project' },
        matches: [{ uuid: 'message-1', type: 'assistant', snippet: 'matching text', timestamp: '2026-07-18T00:00:00Z' }],
      }],
    }))
    return
  }
  if (request.url?.startsWith('/api/sessions/session-1/messages?')) {
    response.end(JSON.stringify({
      sessionId: 'session-1',
      provider: 'claude',
      offset: 0,
      total: 2,
      messages: [{
        type: 'user',
        uuid: 'message-1',
        session_id: 'session-1',
        parent_tool_use_id: null,
        timestamp: '2026-07-18T00:00:00Z',
        provider: 'claude',
        message: { role: 'user', content: 'matching text' },
      }],
    }))
    return
  }
  if (request.url === '/api/sessions/session-1/bookmarks') {
    response.end(JSON.stringify({ ids: ['message-1'] }))
    return
  }
  if (request.url === '/api/sessions/running') {
    response.end(JSON.stringify({ attention: { id: 'attention-1', ...body } }))
    return
  }
  response.statusCode = 404
  response.end(JSON.stringify({ error: 'not found' }))
})

daemon.listen(0, '127.0.0.1')
await once(daemon, 'listening')
const address = daemon.address()
if (!address || typeof address === 'string') throw new Error('Smoke daemon did not bind a TCP port')

const launcher = fileURLToPath(new URL('../bin/agent-viewer.mjs', import.meta.url))
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [launcher, 'mcp', '--attach', String(address.port)],
  stderr: 'pipe',
})
const client = new Client({ name: 'agent-viewer-mcp-smoke', version: '1.0.0' })

try {
  await client.connect(transport)
  const listed = await client.listTools()
  const names = listed.tools.map((tool) => tool.name).sort().join(',')
  if (names !== 'get_session_transcript,post_attention,search_sessions,set_bookmark') {
    throw new Error(`Unexpected bridge tools: ${names}`)
  }

  const search = await client.callTool({
    name: 'search_sessions',
    arguments: { query: 'matching', current_project_only: true },
  })
  const searchPayload = JSON.parse(search.content?.[0]?.text ?? '{}')
  if (searchPayload.results?.[0]?.session_id !== 'session-1') {
    throw new Error('Search result was not mapped through the bridge')
  }

  const transcript = await client.callTool({
    name: 'get_session_transcript',
    arguments: { session_id: 'session-1', provider: 'claude', limit: 1 },
  })
  const transcriptPayload = JSON.parse(transcript.content?.[0]?.text ?? '{}')
  if (transcriptPayload.messages?.[0]?.message?.content !== 'matching text') {
    throw new Error('Transcript messages were not mapped through the bridge')
  }
  if (transcriptPayload.has_more !== true || transcriptPayload.next_offset !== 1) {
    throw new Error('Transcript pagination metadata was not mapped through the bridge')
  }
  if (!seen.some((entry) => (
    entry.method === 'GET'
    && entry.url === '/api/sessions/session-1/messages?offset=0&limit=1&provider=claude'
  ))) {
    throw new Error('Bridge did not request the selected provider transcript')
  }

  const bookmark = await client.callTool({
    name: 'set_bookmark',
    arguments: { session_id: 'session-1', message_uuid: 'message-1', provider: 'claude' },
  })
  const bookmarkPayload = JSON.parse(bookmark.content?.[0]?.text ?? '{}')
  if (bookmarkPayload.bookmarked !== true) throw new Error('Bookmark mutation did not round-trip')

  const attention = await client.callTool({
    name: 'post_attention',
    arguments: { session_id: 'session-1', title: 'Review this', detail: 'Bridge smoke' },
  })
  const attentionPayload = JSON.parse(attention.content?.[0]?.text ?? '{}')
  if (attentionPayload.id !== 'attention-1') throw new Error('Attention mutation did not round-trip')

  if (!seen.some((entry) => entry.method === 'POST' && entry.url === '/api/sessions/running')) {
    throw new Error('Bridge did not post attention to the Agent Viewer daemon')
  }
} finally {
  await client.close().catch(() => {})
  daemon.close()
}

console.log('CLI MCP bridge smoke passed')
