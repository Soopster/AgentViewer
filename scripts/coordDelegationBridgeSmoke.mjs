import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const seen = []
const daemon = createServer(async (request, response) => {
  let text = ''
  for await (const chunk of request) text += chunk
  const body = text ? JSON.parse(text) : {}
  seen.push(body)
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body.action === 'create_run' ? { participant: { runId: 'fixture', agentId: 'lead', token: 'fixture-token', name: 'lead', role: 'lead', provider: 'codex', cwd: '/tmp', capabilities: {} }, snapshot: { run: { id: 'fixture' }, agents: [], tasks: [] } } : { accepted: true }))
})
daemon.listen(0, '127.0.0.1')
await once(daemon, 'listening')
const cwd = await mkdtemp(path.join(tmpdir(), 'coord-bridge-selection-'))
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../bin/agent-viewer.mjs', import.meta.url)), 'mcp', '--attach', String(daemon.address().port)], stderr: 'pipe', env: { ...process.env, AGENT_VIEWER_COORD_IDENTITY_FILE: path.join(cwd, 'identity.json'), AGENT_VIEWER_COORD_TRANSPORT: 'http' } })
const client = new Client({ name: 'coord-delegation-selection', version: '1.0.0' }, {})
try {
  await client.connect(transport)
  const tools = await client.listTools()
  const handoffReader = tools.tools.find(tool => tool.name === 'coord_read_handoff')
  assert.ok(handoffReader.inputSchema.properties.handoff_id)
  assert.equal(handoffReader.annotations.readOnlyHint, true)
  const capabilityTool = tools.tools.find(tool => tool.name === 'coord_capabilities')
  assert.ok(capabilityTool.inputSchema.properties.provider)
  assert.equal(capabilityTool.annotations.readOnlyHint, true)
  const delegate = tools.tools.find(tool => tool.name === 'coord_delegate')
  for (const field of ['name', 'wait_ms', 'requested_provider', 'requested_model', 'requested_effort', 'request_id']) assert.ok(delegate.inputSchema.properties[field], field)
  const created = await client.callTool({ name: 'coord_create_run', arguments: { prompt: 'Fixture', name: 'lead', provider: 'codex', cwd } })
  assert.ok(!created.isError, JSON.stringify(created))
  const checkpoint = await client.callTool({ name: 'coord_read_handoff', arguments: { handoff_id: 'fixture-checkpoint' } })
  assert.ok(!checkpoint.isError, JSON.stringify(checkpoint))
  assert.equal(seen.at(-1).action, 'read_handoff')
  assert.equal(seen.at(-1).handoffId, 'fixture-checkpoint')
  const catalog = await client.callTool({ name: 'coord_capabilities', arguments: { provider: 'claude' } })
  assert.ok(!catalog.isError, JSON.stringify(catalog))
  assert.equal(seen.at(-1).action, 'capabilities')
  assert.equal(seen.at(-1).provider, 'claude')
  const args = { name: 'reviewer', title: 'Review', detail: 'Inspect the changes', requested_provider: 'claude', requested_model: 'custom-model', requested_effort: 'high', wait_ms: 100, request_id: 'round-1' }
  for (let retry = 0; retry < 2; retry++) {
    const result = await client.callTool({ name: 'coord_delegate', arguments: args })
    assert.ok(!result.isError, JSON.stringify(result))
    const sent = seen.at(-1)
    assert.equal(sent.action, 'create_task')
    assert.equal(sent.assignTo, 'auto')
    assert.equal(sent.teammateName, 'reviewer')
    assert.equal(sent.requestedProvider, 'claude')
    assert.equal(sent.requestedModel, 'custom-model')
    assert.equal(sent.requestedEffort, 'high')
    assert.equal(sent.waitMs, 100)
    assert.equal(sent.requestId, 'round-1')
  }
  console.log('Stdio delegation bridge passed: actual MCP discovery and calls retain name, bounded wait, provider/model/effort, and explicit retry identity.')
} finally { await client.close().catch(() => {}); await transport.close().catch(() => {}); daemon.close() }
