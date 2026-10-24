// Spawn resolution for ACP agent subprocesses, shared by two callers with
// different process lifetimes:
//   - bin/agent-viewer-acp-client.mjs (coordinator worker): spawns fresh per
//     tick, no resume. It re-declares the built-in table in plain ESM.
//   - lib/acpClientPool.ts (main session backend): spawns once per session,
//     kept alive across polling requests, resumable.
// No process-lifetime state lives here — only "which command, for whom".

import { parseAcpCommand } from './acpCommand.mjs'
import { currentProviderExecutable, currentProviderInstanceId } from './providerInstances'
import type { AcpProvider } from './provider'

/** `custom` is whatever agent the user configured for the `acp` provider. */
export type AcpAgentKind = 'claude' | 'codex' | 'custom'

/** Providers with a built-in upstream ACP agent adapter. */
export const ACP_TRANSPORT_PROVIDERS: ReadonlySet<AcpAgentKind> = new Set(['claude', 'codex'])

const ACP_AGENT_DEFAULTS: Record<Exclude<AcpAgentKind, 'custom'>, { command: string; envVar: string }> = {
  claude: { command: 'claude-agent-acp', envVar: 'CLAUDE_AGENT_ACP_PATH' },
  codex: { command: 'codex-acp', envVar: 'CODEX_ACP_PATH' },
}

export const CUSTOM_ACP_COMMAND_ENV = 'AGENT_VIEWER_ACP_COMMAND'

export const CUSTOM_ACP_UNCONFIGURED =
  `No ACP agent is configured. Set ${CUSTOM_ACP_COMMAND_ENV} to its command (for example "gemini --experimental-acp"), `
  + 'or add an "acp" entry with an "executable" to .agent-viewer-data/provider-instances.json.'

// The provider id the UI uses and the agent kind the spawner uses are different
// vocabularies, and conflating them is a real mistake rather than a typo: the
// spawn table is keyed by kind, so passing a provider id resolves nothing and —
// because a failed capability probe degrades silently — reads back as "this
// agent supports nothing".
export function acpAgentKindOf(provider: AcpProvider): AcpAgentKind {
  if (provider === 'claude-acp') return 'claude'
  if (provider === 'codex-acp') return 'codex'
  return 'custom'
}

/** The custom agent's command line for the active provider instance, if any. */
function customAcpCommandLine(): string | undefined {
  // An instance's own executable wins; the env variable configures the default
  // instance, so one agent needs no file at all.
  return currentProviderExecutable(process.env[CUSTOM_ACP_COMMAND_ENV]?.trim() ?? '') || undefined
}

export function isAcpAgentConfigured(agentKind: AcpAgentKind): boolean {
  return agentKind !== 'custom' || Boolean(customAcpCommandLine())
}

/** argv for the agent. The custom command never reaches a shell. */
export function resolveAcpAgentSpawn(agentKind: AcpAgentKind): { command: string; args: string[] } {
  if (agentKind === 'custom') {
    const line = customAcpCommandLine()
    if (!line) throw new Error(CUSTOM_ACP_UNCONFIGURED)
    const [command, ...args] = parseAcpCommand(line, 'The ACP agent command')
    return { command: command!, args }
  }
  const entry = ACP_AGENT_DEFAULTS[agentKind]
  if (!entry) throw new Error(`No ACP agent adapter known for provider: ${agentKind}`)
  return { command: process.env[entry.envVar] || entry.command, args: [] }
}

/**
 * What a cache or a pooled subprocess belongs to. Two `acp` instances are two
 * different agents, so a custom agent is keyed by its instance — Gemini's
 * session list must never be served as Goose's.
 */
export function acpAgentKey(agentKind: AcpAgentKind): string {
  return agentKind === 'custom' ? `custom:${currentProviderInstanceId('acp')}` : agentKind
}
