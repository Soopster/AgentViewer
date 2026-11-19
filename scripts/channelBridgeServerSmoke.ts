import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const portProbe = createServer()
portProbe.listen(0, '127.0.0.1')
await once(portProbe, 'listening')
const address = portProbe.address()
if (!address || typeof address === 'string') throw new Error('port probe did not bind')
const port = address.port
await new Promise<void>((resolve, reject) => portProbe.close((err) => err ? reject(err) : resolve()))

const stateDir = await mkdtemp(path.join(tmpdir(), 'agentviewer-channel-smoke-'))
const channelPath = fileURLToPath(new URL('../channels/agentviewer-channel.ts', import.meta.url))
const baseUrl = `http://127.0.0.1:${port}`
const targetSessionId = 'claude-channel-smoke-session'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createClient() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [channelPath],
    stderr: 'pipe',
    env: {
      ...process.env,
      AGENTVIEWER_CHANNEL_PORT: String(port),
      AGENTVIEWER_CHANNEL_SESSION_ID: targetSessionId,
      AGENTVIEWER_CHANNEL_STATE_DIR: stateDir,
    },
  })
  const client = new Client({ name: 'agentviewer-channel-smoke', version: '1.0.0' })
  return { client, transport }
}

async function waitForBridge(): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/status`)
      if (response.ok) return
      lastError = new Error(`status ${response.status}`)
    } catch (err) {
      lastError = err
    }
    await delay(20)
  }
  throw lastError instanceof Error ? lastError : new Error('channel bridge did not start')
}

async function postMessage(messageId: string, text: string, sessionId = targetSessionId) {
  return fetch(`${baseUrl}/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      chat_id: 'chat-smoke',
      message_id: messageId,
      target_session_id: sessionId,
    }),
  })
}

async function waitForNotificationCount(messageId: string, expected: number): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await fetch(`${baseUrl}/status`).then((response) => response.json()) as {
      pending_deliveries: Array<{ message_id: string; notification_count: number }>
    }
    const count = status.pending_deliveries.find((entry) => entry.message_id === messageId)?.notification_count ?? 0
    if (count >= expected) return count
    await delay(20)
  }
  throw new Error(`channel notification ${messageId} did not reach count ${expected}`)
}

let first = createClient()
try {
  await first.client.connect(first.transport)
  await waitForBridge()

  const acceptedResponse = await postMessage('message-accepted', 'durable channel prompt')
  assert.equal(acceptedResponse.status, 200)
  const accepted = await acceptedResponse.json() as { status: string; bridge_session_id: string }
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.bridge_session_id, targetSessionId)
  assert.equal(await waitForNotificationCount('message-accepted', 1), 1)

  const duplicateResponse = await postMessage('message-accepted', 'durable channel prompt')
  assert.equal(duplicateResponse.status, 200)
  assert.equal((await duplicateResponse.json() as { status: string }).status, 'duplicate')

  const mismatch = await postMessage('message-mismatch', 'wrong target', 'different-session')
  assert.equal(mismatch.status, 409)

  await first.client.callTool({ name: 'ack_delivery', arguments: { message_id: 'message-accepted' } })
  const processedResponse = await postMessage('message-accepted', 'durable channel prompt')
  assert.equal((await processedResponse.json() as { status: string }).status, 'processed')

  const pendingResponse = await postMessage('message-replay', 'replay after restart')
  assert.equal(pendingResponse.status, 200)
} finally {
  await first.client.close().catch(() => {})
}

first = createClient()
try {
  await first.client.connect(first.transport)
  await waitForBridge()
  assert.equal(
    await waitForNotificationCount('message-replay', 2),
    2,
    'a pending delivery must be emitted again after the bridge restarts',
  )
  await first.client.callTool({ name: 'ack_delivery', arguments: { message_id: 'message-replay' } })
  const status = await fetch(`${baseUrl}/status`).then((response) => response.json()) as { pending: number }
  assert.equal(status.pending, 0)
} finally {
  await first.client.close().catch(() => {})
  await rm(stateDir, { recursive: true, force: true })
}

console.log('channel bridge server smoke passed')
