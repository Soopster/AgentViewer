/**
 * Minimal local HTTP bridge so the OpenCode server's coordinator plugin
 * (lib/opencodePlugin/agentViewerCoordinator.mjs) can reach `coord_*` actions.
 *
 * Every other in-process provider registers tools that call
 * `executeExternalCoordinatorAction` directly, same-process, no network hop
 * (see lib/agentCoordinationSdkTools.ts). OpenCode is different: its server
 * is a genuinely separate OS process (`createOpencodeServer` shells out via
 * cross-spawn — lib/opencodeClient.ts), so its plugin file runs outside this
 * process's module graph and has no way to call our TS functions directly.
 *
 * The existing HTTP fallback (app/api/agent-protocol/external/route.ts) can't
 * be relied on here — it only exists when the Next.js web app is running,
 * but the OpenCode server (and coordinator runs) can be hosted from the TUI
 * with no web server or AHP sidecar present at all (see CLAUDE.md's --attach
 * notes). This is a tiny, dependency-free `node:http` listener, independent
 * of both, started lazily the first time an in-process OpenCode session
 * needs it and kept alive for the app process's lifetime.
 */
import { createServer, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'

declare global {
  // eslint-disable-next-line no-var
  var __agentViewerCoordinatorBridgePromise: Promise<{ url: string; secret: string; server: Server }> | undefined
}

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

// Bound to 127.0.0.1, but with no secret ANY local process could claim an
// arbitrary sessionId and act as that coordinator agent — dispatch resolves
// identity purely by the sessionId the caller supplies, unlike the external
// HTTP route (app/api/agent-protocol/external) which requires the caller to
// already hold the real per-agent bearer token. This shared secret (set once
// per bridge start, handed to the spawned OpenCode server via env — see
// lib/opencodeClient.ts) narrows that back down to "any process that can
// read this app's environment," matching the trust model the AHP daemon
// already uses for local coordinator access.
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

async function startBridgeServer(): Promise<{ url: string; secret: string; server: Server }> {
  const { dispatchCoordinatorOpenCodeToolCall } = await import('./agentCoordinationSdkTools')
  const secret = randomBytes(24).toString('base64url')
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    const auth = req.headers.authorization ?? ''
    const presented = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
    if (!presented || !timingSafeEqualStrings(presented, secret)) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }
    readBody(req)
      .then(async (raw) => {
        let body: { sessionId?: unknown; tool?: unknown; args?: unknown }
        try {
          body = JSON.parse(raw || '{}') as typeof body
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Invalid JSON body' }))
          return
        }
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const toolName = typeof body.tool === 'string' ? body.tool : ''
        const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args)
          ? body.args as Record<string, unknown>
          : {}
        const result = await dispatchCoordinatorOpenCodeToolCall(sessionId, toolName, args)
        if (!result) {
          res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: `Unknown coordinator tool or session: ${toolName}` }))
          return
        }
        res.writeHead(result.isError ? 400 : 200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ text: result.text }))
      })
      .catch(() => {
        res.writeHead(500).end()
      })
  })
  server.unref()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Failed to allocate coordinator bridge port')
  return { url: `http://127.0.0.1:${address.port}`, secret, server }
}

function ensureBridgeStarted(): Promise<{ url: string; secret: string; server: Server }> {
  if (!globalThis.__agentViewerCoordinatorBridgePromise) {
    globalThis.__agentViewerCoordinatorBridgePromise = startBridgeServer().catch((error) => {
      globalThis.__agentViewerCoordinatorBridgePromise = undefined
      throw error
    })
  }
  return globalThis.__agentViewerCoordinatorBridgePromise
}

/** Base URL of the local coordinator bridge, starting it on first call. */
export async function getCoordinatorBridgeUrl(): Promise<string> {
  return (await ensureBridgeStarted()).url
}

/** Bearer secret every bridge request must present — see the auth check above. */
export async function getCoordinatorBridgeSecret(): Promise<string> {
  return (await ensureBridgeStarted()).secret
}
