import net from 'node:net'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  createOpencodeClient,
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

/**
 * OpenCode 2.x prints a server password and rejects unauthenticated requests
 * (HTTP Basic, user `opencode`). 1.x has no password. A managed server captures
 * its own; an external one is named by `OPENCODE_SERVER_PASSWORD`.
 */
function openCodeAuthHeaders(password?: string): Record<string, string> | undefined {
  const value = password ?? process.env.OPENCODE_SERVER_PASSWORD?.trim()
  if (!value) return undefined
  return { Authorization: `Basic ${Buffer.from(`opencode:${value}`).toString('base64')}` }
}

function openCodeClientFor(baseUrl: string, password?: string): OpencodeClient {
  const config: OpencodeClientConfig = { baseUrl, headers: openCodeAuthHeaders(password) }
  return createOpencodeClient(config)
}

function openCodeV2ClientFor(baseUrl: string, password?: string): OpencodeV2Client {
  return createOpencodeV2Client({ baseUrl, headers: openCodeAuthHeaders(password) })
}

async function canReachOpenCode(baseUrl: string, password?: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/session`, {
      headers: { Accept: 'application/json', ...openCodeAuthHeaders(password) },
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

/**
 * Spawn `opencode serve` ourselves rather than through the SDK's
 * `createOpencodeServer`, which waits for a line reading
 * `opencode server listening on <url>`. OpenCode 2.x prints `server listening
 * on <url>` and a following `server password <value>`, so the SDK helper waits
 * out its timeout against a server that is already up, and every OpenCode
 * session — teammates included — fails to start. Both spellings are accepted
 * here, and a password, when one is printed, authenticates every later request.
 */
/**
 * The bundled SDK (1.18.x, the newest published) speaks OpenCode 1.x's REST
 * API. The 2.x CLI serves a different one — `POST /session` answers 405 — so a
 * teammate staffed on it fails deep inside session creation with a status code
 * that says nothing about why. Checked once, and only for a server we spawn:
 * an external `OPENCODE_BASE_URL` is the user's to choose.
 */
let openCodeCliMajor: number | null | undefined
function unsupportedOpenCodeCliVersion(): string | null {
  if (openCodeCliMajor === undefined) {
    try {
      const output = execFileSync('opencode', ['--version'], { encoding: 'utf8', timeout: 10_000 })
      openCodeCliMajor = Number(/(\d+)\./.exec(output.trim())?.[1] ?? NaN)
      if (!Number.isFinite(openCodeCliMajor)) openCodeCliMajor = null
    } catch {
      openCodeCliMajor = null
    }
  }
  if (openCodeCliMajor === null || openCodeCliMajor < 2) return null
  return `This OpenCode CLI is v${openCodeCliMajor}, whose HTTP API the bundled @opencode-ai/sdk (1.18.x, the newest published) does not speak. Install OpenCode 1.x, or point OPENCODE_BASE_URL at a 1.x server.`
}

async function startManagedServer(): Promise<OpenCodeRuntime> {
  const unsupported = unsupportedOpenCodeCliVersion()
  if (unsupported) throw new Error(unsupported)
  const port = Number(process.env.OPENCODE_PORT) || await findFreePort()
  const timeout = Number(process.env.OPENCODE_START_TIMEOUT_MS) || 15_000
  // The spawned process inherits this environment, so the plugin file can read
  // the bridge URL back out on the other side.
  process.env.AGENT_VIEWER_COORD_BRIDGE_URL = await getCoordinatorBridgeUrl()
  process.env.AGENT_VIEWER_COORD_BRIDGE_SECRET = await getCoordinatorBridgeSecret()
  const child = spawn('opencode', ['serve', '--hostname=127.0.0.1', `--port=${port}`], {
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [coordinatorPluginPath()] }) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const started = await waitForOpenCodeServer(child, timeout)
  const close = () => { try { child.kill('SIGTERM') } catch { /* already gone */ } }
  // A server outliving this process would hold the port and its sessions.
  const onExit = () => close()
  process.once('exit', onExit)

  return {
    client: openCodeClientFor(started.url, started.password),
    clientV2: openCodeV2ClientFor(started.url, started.password),
    server: {
      url: started.url,
      close: () => { process.removeListener('exit', onExit); close() },
    },
  }
}

/** Resolve once the server announces its url; keep reading for a password. */
function waitForOpenCodeServer(child: ChildProcess, timeoutMs: number): Promise<{ url: string; password?: string }> {
  return new Promise((resolve, reject) => {
    let output = ''
    let url: string | undefined
    let password: string | undefined
    let settled = false
    const finish = () => {
      if (settled || !url) return
      settled = true
      clearTimeout(timer)
      clearTimeout(passwordGrace)
      resolve({ url, password })
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(passwordGrace)
      try { child.kill('SIGTERM') } catch { /* already gone */ }
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error(`Timeout waiting for OpenCode to start after ${timeoutMs}ms${output.trim() ? `\nServer output: ${output.trim()}` : ''}`)), timeoutMs)
    let passwordGrace: ReturnType<typeof setTimeout> = setTimeout(() => {}, 0)
    const read = (chunk: Buffer) => {
      output += chunk.toString()
      for (const line of output.split('\n')) {
        const listening = /server listening on\s+(https?:\/\/[^\s]+)/.exec(line)
        if (listening) url = listening[1]
        const secret = /server password\s+(\S+)/.exec(line)
        if (secret) password = secret[1]
      }
      if (url && password) finish()
      // 2.x prints the password right after the url; 1.x never does, so a short
      // grace period after the url is what tells the two apart.
      else if (url) { clearTimeout(passwordGrace); passwordGrace = setTimeout(finish, 250) }
    }
    child.stdout?.on('data', read)
    child.stderr?.on('data', read)
    child.on('error', error => fail(error instanceof Error ? error : new Error(String(error))))
    child.on('exit', code => fail(new Error(`OpenCode server exited with code ${code}${output.trim() ? `\nServer output: ${output.trim()}` : ''}`)))
  })
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
