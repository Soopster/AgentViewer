#!/usr/bin/env bun
// Channel plugin bridging agentViewer's composer to a live `claude` CLI session.
//
// Run with the CLI session you want to bridge into:
//   claude --dangerously-load-development-channels server:agentviewer
//
// agentViewer (or curl, for testing) talks to this process over HTTP on
// AGENTVIEWER_CHANNEL_PORT (default 8790); this process forwards messages into
// the CLI session over MCP/stdio and streams replies + permission prompts back
// out over SSE on /events.
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const PORT = Number(process.env.AGENTVIEWER_CHANNEL_PORT ?? 8790)
// Shared secret between this process and agentViewer; unset disables the check
// (fine for local-only testing, not for anything reachable beyond loopback).
const TOKEN = process.env.AGENTVIEWER_CHANNEL_TOKEN ?? ''
// Bind this bridge process to the Claude session it is launched alongside.
// Supplying the id makes accidental cross-session delivery fail closed and
// gives restarts a stable durable-outbox namespace.
const BRIDGE_SESSION_ID = process.env.AGENTVIEWER_CHANNEL_SESSION_ID?.trim() || ''
const STATE_DIR = process.env.AGENTVIEWER_CHANNEL_STATE_DIR?.trim()
  || path.join(process.cwd(), '.agent-viewer-data', 'channel-bridge')
const STATE_KEY = (BRIDGE_SESSION_ID || `port-${PORT}`).replace(/[^a-zA-Z0-9._-]/g, '_')
const STATE_FILE = path.join(STATE_DIR, `${STATE_KEY}.json`)
const MAX_PROCESSED_IDS = 2_000

type PendingDelivery = {
  message_id: string
  chat_id: string
  target_session_id?: string
  content: string
  accepted_at: string
  notified_at?: string
  notification_count: number
}

type BridgeDeliveryState = {
  version: 1
  pending: PendingDelivery[]
  processed: string[]
}

function sanitizeState(value: unknown): BridgeDeliveryState {
  if (!value || typeof value !== 'object') return { version: 1, pending: [], processed: [] }
  const record = value as Record<string, unknown>
  const pending = Array.isArray(record.pending)
    ? record.pending.flatMap((candidate): PendingDelivery[] => {
      if (!candidate || typeof candidate !== 'object') return []
      const item = candidate as Record<string, unknown>
      if (
        typeof item.message_id !== 'string'
        || typeof item.chat_id !== 'string'
        || typeof item.content !== 'string'
        || typeof item.accepted_at !== 'string'
      ) return []
      return [{
        message_id: item.message_id,
        chat_id: item.chat_id,
        content: item.content,
        accepted_at: item.accepted_at,
        ...(typeof item.target_session_id === 'string' ? { target_session_id: item.target_session_id } : {}),
        ...(typeof item.notified_at === 'string' ? { notified_at: item.notified_at } : {}),
        notification_count: typeof item.notification_count === 'number' && Number.isSafeInteger(item.notification_count)
          ? Math.max(0, item.notification_count)
          : 0,
      }]
    })
    : []
  const processed = Array.isArray(record.processed)
    ? record.processed.filter((entry): entry is string => typeof entry === 'string').slice(-MAX_PROCESSED_IDS)
    : []
  return { version: 1, pending, processed }
}

async function loadState(): Promise<BridgeDeliveryState> {
  try {
    return sanitizeState(JSON.parse(await readFile(STATE_FILE, 'utf8')))
  } catch {
    return { version: 1, pending: [], processed: [] }
  }
}

let deliveryState = await loadState()
let persistChain = Promise.resolve()

function persistState(): Promise<void> {
  const snapshot = JSON.stringify(deliveryState, null, 2)
  persistChain = persistChain.catch(() => {}).then(async () => {
    await mkdir(STATE_DIR, { recursive: true })
    const temporaryPath = path.join(STATE_DIR, `.${STATE_KEY}.${process.pid}.${randomUUID()}.tmp`)
    await writeFile(temporaryPath, snapshot, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, STATE_FILE)
  })
  return persistChain
}

const listeners = new Set<(chunk: string) => void>()
function broadcast(event: Record<string, unknown>) {
  const chunk = `data: ${JSON.stringify(event)}\n\n`
  for (const emit of listeners) emit(chunk)
}

const mcp = new McpServer(
  { name: 'agentviewer', version: '0.0.1' },
  {
    capabilities: {
      experimental: {
        'claude/channel': {},
        // Opt in to permission relay so agentViewer's own approval UI can
        // answer Bash/Write/Edit prompts from a session running in another terminal.
        'claude/channel/permission': {},
      },
      tools: {},
    },
    instructions:
      'Messages arrive as <channel source="agentviewer" chat_id="..." message_id="...">. ' +
      'They come from the agentViewer composer running alongside this terminal. ' +
      'For every message, call ack_delivery with its message_id after you have finished the requested work, immediately before your reply or final completion. ' +
      'Reply with the reply tool, passing the chat_id from the tag so agentViewer ' +
      'routes the response back to the right composer thread.',
  },
)

mcp.registerTool('ack_delivery', {
  description: 'Acknowledge that Claude received a durable agentViewer channel message',
  inputSchema: z.object({
    message_id: z.string().describe('The message_id from the inbound channel tag'),
  }),
}, async ({ message_id }) => {
  const pending = deliveryState.pending.find((entry) => entry.message_id === message_id)
  if (!pending) {
    if (deliveryState.processed.includes(message_id)) {
      return { content: [{ type: 'text', text: 'delivery already acknowledged' }] }
    }
    throw new Error(`unknown channel delivery ${message_id}`)
  }
  deliveryState.pending = deliveryState.pending.filter((entry) => entry.message_id !== message_id)
  deliveryState.processed = [...deliveryState.processed.filter((id) => id !== message_id), message_id]
    .slice(-MAX_PROCESSED_IDS)
  await persistState()
  broadcast({
    type: 'delivery_ack',
    message_id,
    chat_id: pending.chat_id,
    status: 'processed',
    target_session_id: pending.target_session_id,
  })
  return { content: [{ type: 'text', text: 'delivery acknowledged' }] }
})

mcp.registerTool('reply', {
  description: 'Send a message back to the agentViewer composer that pushed this event',
  inputSchema: z.object({
    chat_id: z.string().describe('The chat_id from the inbound <channel> tag'),
    text: z.string().describe('The message to display in agentViewer'),
  }),
}, async ({ chat_id, text }) => {
  broadcast({ type: 'reply', chat_id, text })
  return { content: [{ type: 'text', text: 'sent to agentViewer' }] }
})

// Claude Code (not Claude) calls this when a permission dialog opens locally.
// Forward the structured fields as-is — agentViewer renders its existing
// permission card from them rather than parsing a "yes <id>" chat reply.
const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

mcp.server.setNotificationHandler('notifications/claude/channel/permission_request', PermissionRequestSchema, async ({ params }) => {
  broadcast({ type: 'permission_request', ...params })
})

await mcp.connect(new StdioServerTransport())

let nextChatId = 1

async function notifyDelivery(delivery: PendingDelivery, replay = false): Promise<void> {
  await mcp.server.notification({
    method: 'notifications/claude/channel',
    params: {
      content: delivery.content,
      meta: {
        chat_id: delivery.chat_id,
        message_id: delivery.message_id,
        ...(delivery.target_session_id ? { target_session_id: delivery.target_session_id } : {}),
        ...(replay ? { replay: 'true' } : {}),
      },
    },
  })
  delivery.notified_at = new Date().toISOString()
  delivery.notification_count += 1
  await persistState()
}

async function replayPendingDeliveries(): Promise<void> {
  for (const delivery of deliveryState.pending) {
    try {
      await notifyDelivery(delivery, true)
      const status = deliveryState.processed.includes(delivery.message_id) ? 'processed' : 'accepted'
      broadcast({
        type: 'delivery_ack',
        message_id: delivery.message_id,
        chat_id: delivery.chat_id,
        status,
        target_session_id: delivery.target_session_id,
      })
    } catch (err) {
      console.error(`[agentviewer-channel] failed to replay ${delivery.message_id}:`, err)
      return
    }
  }
}

// EventSource (used by the web client) can't set custom headers, so accept
// the token as a query param too — still loopback-only, so the exposure is minimal.
function authorized(req: Request, url: URL) {
  if (!TOKEN) return true
  return req.headers.get('x-agentviewer-token') === TOKEN || url.searchParams.get('token') === TOKEN
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-agentviewer-token',
}

function withCors(response: Response) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) response.headers.set(key, value)
  return response
}

// The bridge binds a fixed port, so only one bridged `claude` session can run
// at a time. If a stale session is still holding it, Bun.serve throws
// EADDRINUSE — surface that as an actionable line (Claude shows this in the
// MCP server logs) instead of letting the process crash with an opaque
// "failed". The MCP stdio side is already connected, so we exit deliberately.
function startBridge() {
  try {
    Bun.serve({
      port: PORT,
      hostname: '127.0.0.1',
      idleTimeout: 0, // keep SSE streams open
      async fetch(req) {
        const url = new URL(req.url)
        if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }))
        if (!authorized(req, url)) return withCors(new Response('forbidden', { status: 403 }))

        // SSE: agentViewer subscribes here for replies and permission prompts.
        if (req.method === 'GET' && url.pathname === '/events') {
          const stream = new ReadableStream({
            start(ctrl) {
              ctrl.enqueue(': connected\n\n')
              const emit = (chunk: string) => ctrl.enqueue(chunk)
              listeners.add(emit)
              req.signal.addEventListener('abort', () => listeners.delete(emit))
            },
          })
          return withCors(
            new Response(stream, {
              headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
            }),
          )
        }

        // Inbound: agentViewer's composer posts a message here to inject it into the CLI session.
        if (req.method === 'POST' && url.pathname === '/message') {
          const { text, chat_id, message_id, target_session_id } = (await req.json()) as {
            text?: string
            chat_id?: string
            message_id?: string
            target_session_id?: string
          }
          const content = typeof text === 'string' ? text.trim() : ''
          if (!content) return withCors(new Response('message text is required', { status: 400 }))
          const messageId = message_id?.trim() || randomUUID()
          const targetSessionId = target_session_id?.trim() || undefined
          if (BRIDGE_SESSION_ID && targetSessionId && targetSessionId !== BRIDGE_SESSION_ID) {
            return withCors(new Response(
              `target session ${targetSessionId} does not match bridge session ${BRIDGE_SESSION_ID}`,
              { status: 409 },
            ))
          }
          const id = chat_id ?? String(nextChatId++)
          const processed = deliveryState.processed.includes(messageId)
          const existing = deliveryState.pending.find((entry) => entry.message_id === messageId)
          if (existing && (
            existing.content !== content
            || existing.chat_id !== id
            || existing.target_session_id !== targetSessionId
          )) {
            return withCors(new Response(`message id ${messageId} was already used with a different payload`, { status: 409 }))
          }
          if (processed || existing?.notified_at) {
            const known = existing ?? { chat_id: id, target_session_id: targetSessionId }
            const status = processed ? 'processed' : 'duplicate'
            broadcast({
              type: 'delivery_ack',
              message_id: messageId,
              chat_id: known.chat_id,
              status,
              target_session_id: known.target_session_id,
            })
            return withCors(Response.json({
              message_id: messageId,
              chat_id: known.chat_id,
              status,
              target_session_id: known.target_session_id,
              bridge_session_id: BRIDGE_SESSION_ID || undefined,
            }))
          }

          const delivery = existing ?? {
            message_id: messageId,
            chat_id: id,
            target_session_id: targetSessionId,
            content,
            accepted_at: new Date().toISOString(),
            notification_count: 0,
          }
          if (!existing) {
            deliveryState.pending.push(delivery)
            await persistState()
          }
          try {
            await notifyDelivery(delivery)
          } catch (err) {
            console.error(`[agentviewer-channel] failed to notify ${messageId}:`, err)
            return withCors(new Response('channel notification failed; delivery remains queued', { status: 503 }))
          }
          const status = deliveryState.processed.includes(messageId) ? 'processed' : 'accepted'
          broadcast({
            type: 'delivery_ack',
            message_id: messageId,
            chat_id: delivery.chat_id,
            status,
            target_session_id: delivery.target_session_id,
          })
          return withCors(Response.json({
            message_id: messageId,
            chat_id: delivery.chat_id,
            status,
            target_session_id: delivery.target_session_id,
            bridge_session_id: BRIDGE_SESSION_ID || undefined,
          }))
        }

        if (req.method === 'GET' && url.pathname === '/status') {
          return withCors(Response.json({
            bridge_session_id: BRIDGE_SESSION_ID || null,
            pending: deliveryState.pending.length,
            pending_deliveries: deliveryState.pending.map((delivery) => ({
              message_id: delivery.message_id,
              notification_count: delivery.notification_count,
              notified_at: delivery.notified_at,
            })),
            processed: deliveryState.processed.length,
          }))
        }

        // Outbound verdict: agentViewer's permission UI posts the user's allow/deny here.
        if (req.method === 'POST' && url.pathname === '/permission') {
          const { request_id, behavior } = (await req.json()) as {
            request_id: string
            behavior: 'allow' | 'deny'
          }
          await mcp.server.notification({
            method: 'notifications/claude/channel/permission',
            params: { request_id, behavior },
          })
          return withCors(new Response('ok'))
        }

        return withCors(new Response('not found', { status: 404 }))
      },
    })
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    if (code === 'EADDRINUSE') {
      console.error(
        `[agentviewer-channel] port ${PORT} is already in use — another bridged \`claude\` ` +
          `session is holding the agentViewer bridge. Quit that session (its bridge frees the ` +
          `port), or set AGENTVIEWER_CHANNEL_PORT to a free port and point agentViewer's bridge ` +
          `URL at it, then reconnect this session.`,
      )
    } else {
      console.error(`[agentviewer-channel] failed to start HTTP bridge on port ${PORT}:`, err)
    }
    process.exit(1)
  }
}

startBridge()
void replayPendingDeliveries()

// stdout is the MCP transport — log to stderr only.
console.error(
  `[agentviewer-channel] listening on http://127.0.0.1:${PORT}`
  + (BRIDGE_SESSION_ID ? ` for Claude session ${BRIDGE_SESSION_ID}` : ' (unbound session)'),
)
