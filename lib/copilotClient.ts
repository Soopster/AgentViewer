import {
  CopilotClient,
  approveAll,
  type CopilotClientOptions,
  type CopilotSession,
  type ResumeSessionConfig,
} from '@github/copilot-sdk'

function normalizedEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function wrapCopilotError(error: unknown): Error {
  const detail = error instanceof Error ? error.message : 'Unknown Copilot error'
  if (/ENOENT|spawn|not found|@github\/copilot/i.test(detail)) {
    return new Error(
      `Failed to start GitHub Copilot CLI. Options:\n` +
      `  • Set COPILOT_CLI_URL to a running Copilot CLI server (e.g. COPILOT_CLI_URL=http://localhost:3000)\n` +
      `  • Set COPILOT_CLI_PATH to the Copilot CLI binary location\n` +
      `  • Install @github/copilot globally (npm i -g @github/copilot)\n` +
      `Original error: ${detail}`,
    )
  }
  return new Error(`GitHub Copilot provider unavailable. ${detail}`)
}

function isEnvFlagEnabled(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function createClientOptions(): CopilotClientOptions {
  const cliUrl = normalizedEnv(process.env.COPILOT_CLI_URL)
  const cliPath = normalizedEnv(process.env.COPILOT_CLI_PATH)
  const options: CopilotClientOptions = {
    autoStart: true,
    logLevel: 'error',
  }

  if (cliUrl) {
    options.cliUrl = cliUrl
  } else {
    options.useStdio = true
  }

  if (cliPath) {
    options.cliPath = cliPath
  }

  // Opt in to Mission Control via env. Default off because agent-viewer is a
  // local observer; remote sessions would surface in GitHub web/mobile.
  if (isEnvFlagEnabled(process.env.COPILOT_REMOTE) && !cliUrl) {
    options.remote = true
  }

  return options
}

let clientPromise: Promise<CopilotClient> | null = null

async function createClient(): Promise<CopilotClient> {
  let client: CopilotClient
  try {
    client = new CopilotClient(createClientOptions())
  } catch (error) {
    throw wrapCopilotError(error)
  }
  try {
    await client.start()
    return client
  } catch (error) {
    await client.forceStop().catch(() => {})
    throw wrapCopilotError(error)
  }
}

export async function getCopilotClient(): Promise<CopilotClient> {
  clientPromise ??= createClient().catch((error) => {
    clientPromise = null
    throw error
  })
  return clientPromise
}

async function resumeCopilotSession(
  sessionId: string,
  overrides: Partial<ResumeSessionConfig> = {},
): Promise<CopilotSession> {
  const client = await getCopilotClient()
  try {
    return await client.resumeSession(sessionId, {
      onPermissionRequest: approveAll,
      disableResume: true,
      // We're a read-mostly observer; suppress duplicate telemetry events
      // that would otherwise fire on every resume from session list polls.
      enableSessionTelemetry: false,
      ...overrides,
    })
  } catch (error) {
    throw wrapCopilotError(error)
  }
}

// ---- Warm session pool ----
//
// The Copilot CLI keeps its session JSON-RPC connection alive between turns;
// re-running resumeSession on every send adds noticeable latency. We cache one
// streaming-enabled session per sessionId and let callers subscribe via the
// session's native `on()` API per turn. Evicted after TTL to bound memory.
const COPILOT_SESSION_TTL_MS = 5 * 60 * 1000
type CopilotPoolEntry = { session: CopilotSession; lastUsed: number; timer: ReturnType<typeof setTimeout> }
const copilotSessionPool = new Map<string, CopilotPoolEntry>()

function scheduleCopilotEviction(sessionId: string): void {
  const entry = copilotSessionPool.get(sessionId)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(async () => {
    const current = copilotSessionPool.get(sessionId)
    if (!current) return
    if (Date.now() - current.lastUsed < COPILOT_SESSION_TTL_MS) return
    copilotSessionPool.delete(sessionId)
    await current.session.disconnect().catch(() => {})
  }, COPILOT_SESSION_TTL_MS)
  if (typeof entry.timer === 'object' && entry.timer && 'unref' in entry.timer) {
    (entry.timer as { unref: () => void }).unref()
  }
}

export async function acquireCopilotSession(sessionId: string): Promise<CopilotSession> {
  const cached = copilotSessionPool.get(sessionId)
  if (cached) {
    cached.lastUsed = Date.now()
    scheduleCopilotEviction(sessionId)
    return cached.session
  }
  const session = await resumeCopilotSession(sessionId, {
    disableResume: false,
    streaming: true,
  })
  const entry: CopilotPoolEntry = {
    session,
    lastUsed: Date.now(),
    timer: setTimeout(() => {}, 0),
  }
  copilotSessionPool.set(sessionId, entry)
  scheduleCopilotEviction(sessionId)
  return session
}

export async function evictCopilotSession(sessionId: string): Promise<void> {
  const entry = copilotSessionPool.get(sessionId)
  if (!entry) return
  clearTimeout(entry.timer)
  copilotSessionPool.delete(sessionId)
  await entry.session.disconnect().catch(() => {})
}
