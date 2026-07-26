import net from 'node:net'
import {
  createOpencodeClient,
  createOpencodeServer,
  type OpencodeClient,
  type OpencodeClientConfig,
} from '@opencode-ai/sdk'

type OpenCodeRuntime = {
  client: OpencodeClient
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
      server: null,
    }
  }

  return null
}

async function startManagedServer(): Promise<OpenCodeRuntime> {
  const port = Number(process.env.OPENCODE_PORT) || await findFreePort()
  const timeout = Number(process.env.OPENCODE_START_TIMEOUT_MS) || 15_000
  const server = await createOpencodeServer({
    hostname: '127.0.0.1',
    port,
    timeout,
  })

  return {
    client: openCodeClientFor(server.url),
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
