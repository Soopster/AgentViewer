// Fresh-process host for the real route handlers used by the live smoke.
// Start: node --import tsx scripts/coordInteractiveLiveServer.ts
// Then: COORD_SMOKE_ORIGIN=http://127.0.0.1:3218 COORD_SMOKE_PROVIDER=claude
//       COORD_LIVE_ROUNDS=3 node scripts/coordInteractiveLiveSmoke.mjs
// Set COORD_LIVE_PLAN_APPROVAL=1 on the host to test plan gates.
// Avoids reusing dev-server controllers retained across hot reloads.
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { NextRequest } from 'next/server'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Each host owns a separate ledger and participant credentials.
process.chdir(mkdtempSync(path.join(tmpdir(), 'coord-live-server-')))
const create = await import('../app/api/sessions/new/route')
const messages = await import('../app/api/sessions/[sessionId]/messages/route')
const coordination = await import('../app/api/sessions/[sessionId]/coordination/route')
const stop = await import('../app/api/agent-protocol/runs/[runId]/stop/route')

const coordinator = await import('../lib/agentCoordination')

const port = Number(process.env.COORD_LIVE_PORT ?? 3218)
createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    const request = new NextRequest(`http://127.0.0.1:${port}${incoming.url}`, {
      method: incoming.method,
      headers: { 'Content-Type': 'application/json' },
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    })
    const session = request.nextUrl.pathname.match(/^\/api\/sessions\/([^/]+)\/(messages|coordination)$/)
    const run = request.nextUrl.pathname.match(/^\/api\/agent-protocol\/runs\/([^/]+)\/stop$/)
    let response: Response
    if (request.nextUrl.pathname === '/api/sessions/new' && incoming.method === 'POST') {
      const body = await request.clone().json()
      response = await create.POST(request)
      if (response.ok && process.env.COORD_LIVE_PLAN_APPROVAL === '1') {
        const { sessionId } = await response.clone().json()
        await coordinator.createExternalProtocolRun({
          runId: `chat-${createHash('sha256').update(`${body.provider}:${sessionId}`).digest('hex').slice(0, 40)}`,
          provider: body.provider, baseCwd: body.cwd, participantName: 'lead',
          prompt: 'Isolated live plan approval test', requirePlanApproval: true,
        })
      }
    }
    else if (session) {
      const routes = session[2] === 'messages' ? messages : coordination
      const handler = incoming.method === 'GET' ? routes.GET : routes.POST
      response = await handler(request, { params: Promise.resolve({ sessionId: decodeURIComponent(session[1]) }) })
    } else if (run && incoming.method === 'POST') response = await stop.POST(request, { params: Promise.resolve({ runId: run[1] }) })
    else response = new Response('Not found', { status: 404 })
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(outgoing)
    else outgoing.end()
  } catch (error) {
    outgoing.writeHead(500, { 'Content-Type': 'application/json' })
    outgoing.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Route failed' }))
  }
}).listen(port, '127.0.0.1', () => console.log(`Live route host: http://127.0.0.1:${port}`))
