import {
  CopilotClient,
  RuntimeConnection,
  approveAll,
  type CopilotClientOptions,
  type CopilotSession,
  type PermissionHandler,
  type ResumeSessionConfig,
  type SessionConfigBase,
  type TelemetryConfig,
  type CustomAgentConfig,
  type ElicitationHandler,
} from '@github/copilot-sdk'
import { getCoordinatorCopilotTools } from './agentCoordinationSdkTools'

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

function readCustomAgents(): CustomAgentConfig[] | undefined {
  const raw = normalizedEnv(process.env.COPILOT_CUSTOM_AGENTS)
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return undefined
    const agents = parsed.filter((entry): entry is CustomAgentConfig => {
      if (!entry || typeof entry !== 'object') return false
      const value = entry as Record<string, unknown>
      return typeof value.name === 'string' && value.name.trim().length > 0 && typeof value.prompt === 'string'
    })
    return agents.length > 0 ? agents : undefined
  } catch {
    return undefined
  }
}

function readCopilotTelemetry(): TelemetryConfig | undefined {
  const filePath = normalizedEnv(process.env.COPILOT_OTEL_FILE)
  const otlpEndpoint = normalizedEnv(process.env.COPILOT_OTEL_ENDPOINT)
  if (!filePath && !otlpEndpoint) return undefined
  return {
    ...(filePath ? { filePath, exporterType: 'file' } : {}),
    ...(otlpEndpoint ? { otlpEndpoint, exporterType: 'otlp-http' } : {}),
    sourceName: 'agent-viewer.copilot',
    captureContent: isEnvFlagEnabled(process.env.COPILOT_OTEL_CAPTURE_CONTENT),
  }
}

function createClientOptions(): CopilotClientOptions {
  const cliUrl = normalizedEnv(process.env.COPILOT_CLI_URL)
  const cliPath = normalizedEnv(process.env.COPILOT_CLI_PATH)
  const options: CopilotClientOptions = {
    connection: cliUrl
      ? RuntimeConnection.forUri(cliUrl)
      : RuntimeConnection.forStdio(cliPath ? { path: cliPath } : undefined),
    logLevel: 'error',
  }
  const telemetry = readCopilotTelemetry()
  if (telemetry) options.telemetry = telemetry

  // Opt in to Mission Control via env. Default off because agent-viewer is a
  // local observer; remote sessions would surface in GitHub web/mobile.
  if (isEnvFlagEnabled(process.env.COPILOT_REMOTE) && !cliUrl) {
    options.enableRemoteSessions = true
  }

  return options
}

// Session-level config shared by both createSession (new sessions) and
// resumeSession (every poll/resume of an existing one) — SessionConfigBase
// covers both. excludedBuiltinAgents/sessionLimits are opt-in via env since
// they change what the agent can do; enableCitations is safe to default on,
// since it's a no-op for providers that don't support it and copilotMapper's
// applyCitations already renders the result as a plain sources footer.
export function copilotSessionConfigOverrides(sessionId?: string): Partial<SessionConfigBase> {
  const overrides: Partial<SessionConfigBase> = {
    enableCitations: true,
    enableConfigDiscovery: true,
  }

  // Coordinator sessions get their coord_* tools registered by session id
  // (see lib/agentCoordinationSdkTools.ts) right after beginExecutionPhase
  // creates them, before the first resumeSession call — every other Copilot
  // session (sessionId omitted at the initial createSession call, or simply
  // not a coordinator participant) gets none.
  const coordinatorTools = sessionId ? getCoordinatorCopilotTools(sessionId) : undefined
  if (coordinatorTools?.length) overrides.tools = coordinatorTools as SessionConfigBase['tools']

  const customAgents = readCustomAgents()
  if (customAgents) overrides.customAgents = customAgents

  if (isEnvFlagEnabled(process.env.COPILOT_AUTO_APPROVE_PLAN)) {
    overrides.onExitPlanModeRequest = (request) => ({
      approved: true,
      selectedAction: request.recommendedAction,
    })
  }
  if (isEnvFlagEnabled(process.env.COPILOT_AUTO_MODE_SWITCH)) {
    overrides.onAutoModeSwitchRequest = () => 'yes'
  }

  const excludedAgents = normalizedEnv(process.env.COPILOT_EXCLUDED_AGENTS)
  if (excludedAgents) {
    overrides.excludedBuiltinAgents = excludedAgents.split(',').map((name) => name.trim()).filter(Boolean)
  }

  const maxAiCredits = Number(normalizedEnv(process.env.COPILOT_MAX_AI_CREDITS))
  if (Number.isFinite(maxAiCredits) && maxAiCredits > 0) {
    overrides.sessionLimits = { maxAiCredits }
  }

  // Grant read/write access to extra directories beyond the session's working
  // directory — e.g. a coordinator teammate's worktree plus the shared repo
  // checkout. Must be re-supplied on every resume (the SDK doesn't persist it).
  const additionalDirectories = normalizedEnv(process.env.COPILOT_ADDITIONAL_DIRECTORIES)
  if (additionalDirectories) {
    overrides.additionalDirectories = additionalDirectories.split(',').map((dir) => dir.trim()).filter(Boolean)
  }

  return overrides
}

export function copilotIntegrationDiagnostics(sessionId?: string): string[] {
  const items = ['Config discovery enabled']
  if (readCustomAgents()) items.push('Custom agents configured')
  if (readCopilotTelemetry()) items.push('OpenTelemetry tracing enabled')
  else items.push('OpenTelemetry tracing disabled (set COPILOT_OTEL_FILE or COPILOT_OTEL_ENDPOINT)')
  if (isEnvFlagEnabled(process.env.COPILOT_AUTO_APPROVE_PLAN)) items.push('Plan exit auto-approval enabled')
  if (isEnvFlagEnabled(process.env.COPILOT_AUTO_MODE_SWITCH)) items.push('Rate-limit auto-mode switching enabled')
  if (normalizedEnv(process.env.COPILOT_ADDITIONAL_DIRECTORIES)) items.push('Additional directories granted')
  const stopReason = sessionId ? copilotLastStopReason.get(sessionId) : undefined
  if (stopReason) items.push(`Last agent stop: ${stopReason}`)
  return items
}

// The Copilot SDK only accepts a permission handler at resume time, but our
// warm session pool resumes once and reuses the session across turns — some
// turns auto-approve, others route through an interactive bridge. We resume
// with a stable dispatcher that reads the current handler from this map so a
// turn can swap behavior without forcing a re-resume.
type CopilotPoolEntry = { session: CopilotSession; lastUsed: number; timer: ReturnType<typeof setTimeout> }

declare global {
  // Copilot's client and streaming sessions retain JSON-RPC subscriptions and
  // permission dispatch closures. Preserve the complete runtime across Next.js
  // reloads so new routes keep controlling the same live provider objects.
  // eslint-disable-next-line no-var
  var __agentViewerCopilotPermissionHandlers: Map<string, PermissionHandler> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCopilotElicitationHandlers: Map<string, ElicitationHandler> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCopilotClientPromise: Promise<CopilotClient> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCopilotSessionPool: Map<string, CopilotPoolEntry> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCopilotSessionInflight: Map<string, Promise<CopilotSession>> | undefined
  // eslint-disable-next-line no-var
  var __agentViewerCopilotLastStopReason: Map<string, string> | undefined
}

const copilotPermissionHandlers = globalThis.__agentViewerCopilotPermissionHandlers
  ?? (globalThis.__agentViewerCopilotPermissionHandlers = new Map<string, PermissionHandler>())
const copilotElicitationHandlers = globalThis.__agentViewerCopilotElicitationHandlers
  ?? (globalThis.__agentViewerCopilotElicitationHandlers = new Map<string, ElicitationHandler>())
// AgentStop fires once per turn when the top-level agent reaches a natural
// terminal stop (not aborted, not blocked by a rejected tool) — a definitive
// completion signal the event stream's turn_end doesn't distinguish from an
// interrupted/errored end. Last reason per session, surfaced in diagnostics.
const copilotLastStopReason = globalThis.__agentViewerCopilotLastStopReason
  ?? (globalThis.__agentViewerCopilotLastStopReason = new Map<string, string>())

export function getCopilotLastStopReason(sessionId: string): string | undefined {
  return copilotLastStopReason.get(sessionId)
}

export function setCopilotPermissionHandler(sessionId: string, handler: PermissionHandler): void {
  copilotPermissionHandlers.set(sessionId, handler)
}

export function clearCopilotPermissionHandler(sessionId: string): void {
  copilotPermissionHandlers.delete(sessionId)
}

export function setCopilotElicitationHandler(sessionId: string, handler: ElicitationHandler): void {
  copilotElicitationHandlers.set(sessionId, handler)
}

export function clearCopilotElicitationHandler(sessionId: string): void {
  copilotElicitationHandlers.delete(sessionId)
}

/**
 * Inject text into Copilot's current agentic loop. `immediate` is the SDK's
 * native steering mode; the default `enqueue` would start a separate run after
 * the current one and duplicate AgentViewer's own durable follow-up queue.
 */
export async function steerCopilotSession(
  session: Pick<CopilotSession, 'send'>,
  text: string,
): Promise<string> {
  return session.send({ prompt: text, mode: 'immediate' })
}

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
  if (!globalThis.__agentViewerCopilotClientPromise) {
    const client = createClient().catch((error) => {
      if (globalThis.__agentViewerCopilotClientPromise === client) {
        globalThis.__agentViewerCopilotClientPromise = undefined
      }
      throw error
    })
    globalThis.__agentViewerCopilotClientPromise = client
  }
  return globalThis.__agentViewerCopilotClientPromise
}

async function resumeCopilotSession(
  sessionId: string,
  overrides: Partial<ResumeSessionConfig> = {},
): Promise<CopilotSession> {
  const client = await getCopilotClient()
  try {
    return await client.resumeSession(sessionId, {
      onPermissionRequest: (request, invocation) =>
        (copilotPermissionHandlers.get(sessionId) ?? approveAll)(request, invocation),
      onElicitationRequest: (context) =>
        (copilotElicitationHandlers.get(sessionId) ?? (() => ({ action: 'decline' as const })))(context),
      hooks: {
        onAgentStop: (input) => {
          if (input.stopReason) copilotLastStopReason.set(sessionId, input.stopReason)
        },
      },
      suppressResumeEvent: true,
      // We're a read-mostly observer; suppress duplicate telemetry events
      // that would otherwise fire on every resume from session list polls.
      enableSessionTelemetry: false,
      ...copilotSessionConfigOverrides(sessionId),
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
const copilotSessionPool = globalThis.__agentViewerCopilotSessionPool
  ?? (globalThis.__agentViewerCopilotSessionPool = new Map<string, CopilotPoolEntry>())
const copilotSessionInflight = globalThis.__agentViewerCopilotSessionInflight
  ?? (globalThis.__agentViewerCopilotSessionInflight = new Map<string, Promise<CopilotSession>>())

/** Number of warm Copilot sessions currently pooled. Diagnostics only. */
export function copilotPoolSize(): number {
  return copilotSessionPool.size
}

function scheduleCopilotEviction(sessionId: string): void {
  const entry = copilotSessionPool.get(sessionId)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(async () => {
    const current = copilotSessionPool.get(sessionId)
    if (!current) return
    if (Date.now() - current.lastUsed < COPILOT_SESSION_TTL_MS) return
    copilotSessionPool.delete(sessionId)
    clearCopilotPermissionHandler(sessionId)
    clearCopilotElicitationHandler(sessionId)
    copilotLastStopReason.delete(sessionId)
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
  const inflight = copilotSessionInflight.get(sessionId)
  if (inflight) return inflight
  const build = resumeCopilotSession(sessionId, {
    suppressResumeEvent: false,
    streaming: true,
  }).then((session) => {
    const entry: CopilotPoolEntry = {
      session,
      lastUsed: Date.now(),
      timer: setTimeout(() => {}, 0),
    }
    copilotSessionPool.set(sessionId, entry)
    scheduleCopilotEviction(sessionId)
    return session
  })
  copilotSessionInflight.set(sessionId, build)
  build.finally(() => copilotSessionInflight.delete(sessionId)).catch(() => {})
  return build
}

export async function evictCopilotSession(sessionId: string): Promise<void> {
  await copilotSessionInflight.get(sessionId)?.catch(() => {})
  const entry = copilotSessionPool.get(sessionId)
  if (!entry) return
  clearTimeout(entry.timer)
  copilotSessionPool.delete(sessionId)
  clearCopilotPermissionHandler(sessionId)
  clearCopilotElicitationHandler(sessionId)
  await entry.session.disconnect().catch(() => {})
}
