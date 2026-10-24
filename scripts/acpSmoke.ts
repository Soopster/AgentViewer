import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const child = spawn(process.execPath, [
  'run',
  'bin/agent-viewer-acp.ts',
  '--provider',
  'claude',
], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
})
const childExit = once(child, 'exit')

let stderr = ''
child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk: string) => { stderr += chunk })

const responses = new Map<number, (value: Record<string, unknown>) => void>()
const lines = createInterface({ input: child.stdout })
lines.on('line', (line) => {
  const message = JSON.parse(line) as { id?: unknown }
  if (typeof message.id !== 'number') return
  responses.get(message.id)?.(message as Record<string, unknown>)
  responses.delete(message.id)
})

function request(id: number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ACP ${method}`)), 10_000)
    responses.set(id, (value) => {
      clearTimeout(timeout)
      resolve(value)
    })
  })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  return response
}

try {
  const initialized = await request(1, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
    clientInfo: { name: 'agent-viewer-acp-smoke', version: '1.0.0' },
  })
  const result = initialized.result as Record<string, unknown>
  assert.equal(result.protocolVersion, PROTOCOL_VERSION)
  const capabilities = result.agentCapabilities as Record<string, unknown>
  assert.equal(capabilities.loadSession, true)
  assert.deepEqual(capabilities.promptCapabilities, { image: false, audio: false, embeddedContext: false })
  assert.deepEqual(capabilities.sessionCapabilities, {
    list: {},
    delete: {},
    resume: {},
    close: {},
  })

  const invalidPath = await request(2, 'session/new', {
    cwd: 'relative/path',
    mcpServers: [],
  })
  const error = invalidPath.error as { code?: unknown }
  assert.equal(error.code, -32602)

  console.log('ACP v1 stdio conformance smoke passed')
} finally {
  child.stdin.end()
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
  await childExit
  clearTimeout(timer)
  if (child.exitCode !== 0) throw new Error(`ACP smoke child failed (${child.exitCode}): ${stderr}`)
}
