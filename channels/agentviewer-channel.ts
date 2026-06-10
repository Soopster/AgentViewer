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
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

const PORT = Number(process.env.AGENTVIEWER_CHANNEL_PORT ?? 8790)
// Shared secret between this process and agentViewer; unset disables the check
// (fine for local-only testing, not for anything reachable beyond loopback).
const TOKEN = process.env.AGENTVIEWER_CHANNEL_TOKEN ?? ''

const listeners = new Set<(chunk: string) => void>()
function broadcast(event: Record<string, unknown>) {
  const chunk = `data: ${JSON.stringify(event)}\n\n`
  for (const emit of listeners) emit(chunk)
}

const mcp = new Server(
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
      'Messages arrive as <channel source="agentviewer" chat_id="...">. ' +
      'They come from the agentViewer composer running alongside this terminal. ' +
      'Reply with the reply tool, passing the chat_id from the tag so agentViewer ' +
      'routes the response back to the right composer thread.',
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message back to the agentViewer composer that pushed this event',
      inputSchema: {
        type: 'object',
        properties: {
          chat_id: { type: 'string', description: 'The chat_id from the inbound <channel> tag' },
          text: { type: 'string', description: 'The message to display in agentViewer' },
        },
        required: ['chat_id', 'text'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name !== 'reply') throw new Error(`unknown tool: ${req.params.name}`)
  const { chat_id, text } = req.params.arguments as { chat_id: string; text: string }
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

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  broadcast({ type: 'permission_request', ...params })
})

await mcp.connect(new StdioServerTransport())

let nextChatId = 1

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
          const { text, chat_id } = (await req.json()) as { text: string; chat_id?: string }
          const id = chat_id ?? String(nextChatId++)
          await mcp.notification({
            method: 'notifications/claude/channel',
            params: { content: text, meta: { chat_id: id } },
          })
          return withCors(Response.json({ chat_id: id }))
        }

        // Outbound verdict: agentViewer's permission UI posts the user's allow/deny here.
        if (req.method === 'POST' && url.pathname === '/permission') {
          const { request_id, behavior } = (await req.json()) as {
            request_id: string
            behavior: 'allow' | 'deny'
          }
          await mcp.notification({
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

// stdout is the MCP transport — log to stderr only.
console.error(`[agentviewer-channel] listening on http://127.0.0.1:${PORT}`)
