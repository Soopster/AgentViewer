/**
 * ACP (Agent Client Protocol) client-side driver for the Coordinator worker
 * — the alternate transport to agent-viewer-coord-worker.mjs's default raw
 * provider-CLI spawn.
 *
 * Why this exists: the default transport wires coord_* tools into each
 * provider CLI through that CLI's own bespoke MCP mechanism — Claude's
 * `--mcp-config`, Codex's `-c mcp_servers.*`, OpenCode's `OPENCODE_CONFIG`
 * file, Copilot's `--additional-mcp-config`, Pi's `pi-mcp-adapter` config
 * file — five separate spawn+parse implementations, each hand-decoding that
 * CLI's own streaming JSON shape. ACP standardizes the client<->agent
 * session lifecycle (`session/new` -> `session/prompt` -> `session/update`)
 * and, critically, *how MCP servers are declared* (`session/new.mcpServers`)
 * — one mechanism instead of five. It does not remove MCP: the ACP agent
 * still reaches coord_* tools through MCP underneath, same as today. The win
 * is fewer bespoke per-CLI code paths and a normalized update/permission
 * model, not "no more MCP".
 *
 * Only two of our five providers have a real ACP adapter today —
 * `claude-agent-acp` and `codex-acp` (`@agentclientprotocol/*-acp` npm
 * packages). Confirmed against buzz's (a sibling multi-agent platform) own
 * recognized-agent allowlist, which lists exactly `goose`, `codex-acp`,
 * `claude-agent-acp`/`claude-code-acp`, and its own minimal agent — nothing
 * for OpenCode, Copilot, or Pi. Those three stay on the raw-CLI transport.
 *
 * Known v1 limitation: every tick starts a fresh `session/new` rather than
 * resuming the previous tick's ACP session via `session/load`. Unlike the
 * raw-CLI transport (which resumes for conversational continuity), coord
 * ticks are designed to be self-contained — the tick prompt always says
 * "start with coord_status" and never assumes the agent remembers prior
 * ticks — so a fresh session per tick is correct, just not context-cache
 * efficient. Wiring `session/load` is a follow-up if that cost matters.
 *
 * This module is plain ESM (no TypeScript) because agent-viewer-coord-worker.mjs
 * runs under vanilla `node`, with no tsx/bun loader — see how it's spawned
 * in bin/agent-viewer.mjs (`spawn(process.execPath, [entrypoint, ...])`).
 */
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { client, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

// This runs under vanilla `node` (see module doc above) so it can't import
// lib/acpAgentSpawn.ts directly — re-declared here in plain ESM, kept in
// sync by hand. Any change to the provider set or env var names must be
// mirrored in lib/acpAgentSpawn.ts (used by lib/acpClientPool.ts).

/** Providers with a real upstream ACP agent adapter. */
export const ACP_TRANSPORT_PROVIDERS = new Set(['claude', 'codex'])

const ACP_AGENT_DEFAULTS = {
  claude: { command: 'claude-agent-acp', envVar: 'CLAUDE_AGENT_ACP_PATH' },
  codex: { command: 'codex-acp', envVar: 'CODEX_ACP_PATH' },
}

export function resolveAcpAgentCommand(providerId) {
  const entry = ACP_AGENT_DEFAULTS[providerId]
  if (!entry) throw new Error(`No ACP agent adapter known for provider: ${providerId}`)
  return process.env[entry.envVar] || entry.command
}

/**
 * Auto-approves every permission request — coord ticks are unattended, no
 * human is present to answer a prompt. Mirrors the raw-CLI transport's own
 * unattended pre-allow (Claude `--permission-mode auto` + `--allowedTools
 * mcp__agent-viewer__*`, OpenCode `--auto`, Copilot `--allow-all-tools
 * --no-ask-user`, Codex `approval_policy="never"`).
 */
function pickAutoApproveOption(options) {
  const preferredKinds = ['allow_once', 'allow_always']
  for (const kind of preferredKinds) {
    const option = options.find((candidate) => candidate.kind === kind)
    if (option) return { outcome: { outcome: 'selected', optionId: option.optionId } }
  }
  return { outcome: { outcome: 'cancelled' } }
}

function buildCoordClientApp() {
  return client({ name: 'agent-viewer-coord-worker' })
    // Coordinator ticks consume activity through the raw-output tap, but ACP
    // still requires the Client side to accept the Agent's session updates.
    .onNotification('session/update', async () => {})
    .onRequest('session/request_permission', async (ctx) => pickAutoApproveOption(ctx.params.options))
    // Coord ticks never need the agent to touch the client's own filesystem
    // (the agent already has full shell/file tools of its own via coord_*
    // and its native toolset) — decline politely rather than silently no-op.
    .onRequest('fs/read_text_file', async () => {
      throw new Error('agent-viewer-coord-worker does not expose client-side filesystem access')
    })
    .onRequest('fs/write_text_file', async () => {
      throw new Error('agent-viewer-coord-worker does not expose client-side filesystem access')
    })
}

/**
 * Converts the child's stdout to a web ReadableStream for the ACP transport,
 * tapping a second branch through `onOutput` (for worker-log/activity parity
 * with the raw-CLI transport) via `.tee()` rather than a Node `'data'`
 * listener — attaching a listener directly on `child.stdout` would race
 * `Readable.toWeb`'s own internal consumption of the same flowing-mode
 * bytes and could starve either side.
 */
function tapStdout(child, onOutput) {
  const web = Readable.toWeb(child.stdout)
  if (!onOutput) return web
  const [forAcp, forLog] = web.tee()
  void pumpToCallback(forLog, (chunk) => onOutput(Buffer.from(chunk), 'stdout'))
  return forAcp
}

async function pumpToCallback(stream, onChunk) {
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (value) onChunk(value)
    }
  } catch {
    // Reader errors surface through the primary ACP stream too; this tap is
    // best-effort logging only.
  } finally {
    reader.releaseLock()
  }
}

/**
 * Runs one Coordinator tick against an ACP agent subprocess: spawns it,
 * declares the coord_* MCP server via `session/new`, sends `prompt`, and
 * drains `session/update` notifications (auto-approving any permission
 * requests) until the turn stops. Resolves with the ACP session id and stop
 * reason, or rejects if the subprocess errors, exits non-zero, or the caller
 * aborts `signal`.
 *
 * `options`: { providerId, command?, args?, cwd, prompt, mcpServer: {name,
 * command, args}, additionalDirectories?, env?, signal?, onOutput?(chunk,
 * 'stdout'|'stderr') }
 */
export async function runAcpProviderTick(options) {
  const command = options.command ?? resolveAcpAgentCommand(options.providerId)
  const child = spawn(command, options.args ?? [], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  child.stderr.on('data', (chunk) => options.onOutput?.(chunk, 'stderr'))

  const abortListener = () => {
    try { child.kill('SIGTERM') } catch { /* already exited */ }
  }
  options.signal?.addEventListener('abort', abortListener, { once: true })

  const spawnError = new Promise((_resolve, reject) => {
    child.once('error', reject)
  })

  try {
    const stream = ndJsonStream(Writable.toWeb(child.stdin), tapStdout(child, options.onOutput))
    const clientApp = buildCoordClientApp()

    return await Promise.race([
      spawnError,
      clientApp.connectWith(stream, async (ctx) => {
        if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted before initialize')
        await ctx.request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
          clientInfo: { name: 'agent-viewer-coord-worker', title: 'Agent Viewer Coordinator Worker', version: '0.1.0' },
        })
        return ctx
          .buildSession({
            cwd: options.cwd,
            mcpServers: [{ name: options.mcpServer.name, command: options.mcpServer.command, args: options.mcpServer.args, env: [] }],
            ...(options.additionalDirectories?.length ? { additionalDirectories: options.additionalDirectories } : {}),
          })
          .withSession(async (session) => {
            const response = await session.prompt(options.prompt, { cancellationSignal: options.signal })
            return { sessionId: session.sessionId, stopReason: response.stopReason }
          })
      }),
    ])
  } finally {
    options.signal?.removeEventListener('abort', abortListener)
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL') } catch { /* already exited */ }
    }
  }
}
