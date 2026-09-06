import net from 'node:net'
import { fileURLToPath } from 'node:url'
import {
  createOpencodeClient,
  createOpencodeServer,
  type OpencodeClient,
  type OpencodeClientConfig,
} from '@opencode-ai/sdk'
import {
  createOpencodeClient as createOpencodeV2Client,
  type OpencodeClient as OpencodeV2Client,
} from '@opencode-ai/sdk/v2'
import { getCoordinatorBridgeUrl, getCoordinatorBridgeSecret } from './coordinatorBridgeServer'

type OpenCodeRuntime = {
  client: OpencodeClient
  clientV2: OpencodeV2Client
  server: { url: string; close(): void } | null
}

declare global {
  // The managed OpenCode server is process-owned, not module-owned. Preserve
  // it across Next.js reloads so a route refresh cannot spawn a second server.
  // eslint-disable-next-line no-var
  var __agentViewerOpenCodeRuntimePromise: Promise<OpenCodeRuntime> | undefined
}

function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : null
}

function openCodeClientFor(baseUrl: string): OpencodeClient {
  const config: OpencodeClientConfig = { baseUrl }
  return createOpencodeClient(config)
}

function openCodeV2ClientFor(baseUrl: string): OpencodeV2Client {
  return createOpencodeV2Client({ baseUrl })
}

async function canReachOpenCode(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/session`, {
      headers: { Accept: 'application/json' },
    })
    return response.ok
  } catch {
    return false
  }
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate OpenCode port')))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function connectExistingServer(): Promise<OpenCodeRuntime | null> {
  const configuredUrl = normalizeBaseUrl(process.env.OPENCODE_BASE_URL)
  const candidates = [
    configuredUrl,
    normalizeBaseUrl(process.env.OPENCODE_SERVER_URL),
    'http://127.0.0.1:4096',
  ].filter((value, index, list): value is string => Boolean(value) && list.indexOf(value) === index)

  for (const baseUrl of candidates) {
    if (!(await canReachOpenCode(baseUrl))) continue
    return {
      client: openCodeClientFor(baseUrl),
      clientV2: openCodeV2ClientFor(baseUrl),
      server: null,
    }
  }

  return null
}

// Every session on this managed server sees the coord_* tools this plugin
// registers, coordinator participant or not — OpenCode's plugin API has no
// per-session tool registration, only one static set for the whole server
// (see lib/opencodePlugin/agentViewerCoordinator.mjs). A call from a session
// that isn't bound to a run degrades gracefully instead of failing. This
// only reaches sessions on a server *this app* spawns — attaching to an
// externally-managed `opencode serve` (OPENCODE_BASE_URL/OPENCODE_SERVER_URL)
// never loads it, so OpenCode coordinator agents need the default managed
// server path.
function coordinatorPluginPath(): string {
  const override = process.env.AGENT_VIEWER_OPENCODE_PLUGIN_PATH?.trim()
  if (override) return override
  return fileURLToPath(new URL('./opencodePlugin/agentViewerCoordinator.mjs', import.meta.url))
}

async function startManagedServer(): Promise<OpenCodeRuntime> {
  const port = Number(process.env.OPENCODE_PORT) || await findFreePort()
  const timeout = Number(process.env.OPENCODE_START_TIMEOUT_MS) || 15_000
  // createOpencodeServer forwards the current process.env to the spawned
  // `opencode serve` process (cross-spawn, no env override) — set the bridge
  // URL here so the plugin file can read it back out on the other side.
  process.env.AGENT_VIEWER_COORD_BRIDGE_URL = await getCoordinatorBridgeUrl()
  process.env.AGENT_VIEWER_COORD_BRIDGE_SECRET = await getCoordinatorBridgeSecret()
  const server = await createOpencodeServer({
    hostname: '127.0.0.1',
    port,
    timeout,
    config: { plugin: [coordinatorPluginPath()] },
  })

  return {
    client: openCodeClientFor(server.url),
    clientV2: openCodeV2ClientFor(server.url),
    server,
  }
}

async function createRuntime(): Promise<OpenCodeRuntime> {
  const existing = await connectExistingServer()
  if (existing) return existing

  try {
    return await startManagedServer()
  } catch (error) {
    const existingAfterFailure = await connectExistingServer()
    if (existingAfterFailure) return existingAfterFailure

    const detail = error instanceof Error ? error.message : 'Unknown OpenCode startup error'
    throw new Error(
      [
        'Failed to start or connect to OpenCode.',
        'If OpenCode startup is blocked by provider/model resolution, start `opencode serve` yourself and set `OPENCODE_BASE_URL` to that server.',
        detail,
      ].join(' '),
    )
  }
}

async function getOpenCodeRuntime(): Promise<OpenCodeRuntime> {
  if (!globalThis.__agentViewerOpenCodeRuntimePromise) {
    const runtime = createRuntime().catch((error) => {
      if (globalThis.__agentViewerOpenCodeRuntimePromise === runtime) {
        globalThis.__agentViewerOpenCodeRuntimePromise = undefined
      }
      throw error
    })
    globalThis.__agentViewerOpenCodeRuntimePromise = runtime
  }
  return globalThis.__agentViewerOpenCodeRuntimePromise
}

export async function getOpenCodeClient(): Promise<OpencodeClient> {
  return (await getOpenCodeRuntime()).client
}

/**
 * The package keeps its compatibility client at the root while newer native
 * question APIs live on the v2 client. Both clients share the same long-lived
 * server process; this does not add another connection manager or subprocess.
 */
export async function getOpenCodeV2Client(): Promise<OpencodeV2Client> {
  return (await getOpenCodeRuntime()).clientV2
}

/**
 * True when this app spawned and owns the running OpenCode server (so its
 * coordinator plugin is loaded — see coordinatorPluginPath above); false when
 * attached to an externally-managed `opencode serve` (OPENCODE_BASE_URL /
 * OPENCODE_SERVER_URL / the default-port fallback), which never has it.
 */
export async function isOpenCodeManagedServer(): Promise<boolean> {
  return (await getOpenCodeRuntime()).server !== null
}
