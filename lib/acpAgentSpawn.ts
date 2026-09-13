// Pure spawn-resolution logic for ACP agent subprocesses (claude-agent-acp,
// codex-acp), shared by two callers with different process lifetimes:
//   - bin/agent-viewer-acp-client.mjs (coordinator worker): spawns fresh per
//     tick, no resume.
//   - lib/acpClientPool.ts (main session backend): spawns once per session,
//     kept alive across polling requests, resumable.
// No process-lifetime state lives here — only "which binary, which env var".

export type AcpAgentKind = 'claude' | 'codex'

/** Providers with a real upstream ACP agent adapter. */
export const ACP_TRANSPORT_PROVIDERS: ReadonlySet<AcpAgentKind> = new Set(['claude', 'codex'])

const ACP_AGENT_DEFAULTS: Record<AcpAgentKind, { command: string; envVar: string }> = {
  claude: { command: 'claude-agent-acp', envVar: 'CLAUDE_AGENT_ACP_PATH' },
  codex: { command: 'codex-acp', envVar: 'CODEX_ACP_PATH' },
}

export function resolveAcpAgentCommand(agentKind: AcpAgentKind): string {
  const entry = ACP_AGENT_DEFAULTS[agentKind]
  if (!entry) throw new Error(`No ACP agent adapter known for provider: ${agentKind}`)
  return process.env[entry.envVar] || entry.command
}
