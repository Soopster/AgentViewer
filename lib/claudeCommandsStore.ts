import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'

// Mid-session slash-command pushes (system/commands_changed). The SDK's
// supportedCommands() returns the list captured at initialize and never
// reflects mid-session changes (e.g. skills discovered as the agent works in a
// subdirectory) — the push is the only source of truth after that. Both the
// turn-1 send loop and the pool pump feed frames in here; command reads prefer
// the pushed list over the control RPC. LRU-capped like the other
// session-keyed maps (see the web memory audit).
const MAX_SESSIONS = 64
const overrides = new Map<string, SlashCommand[]>()

export function noteClaudeCommandsChanged(sessionId: string | undefined, message: unknown): void {
  if (!sessionId) return
  const record = message as { type?: string; subtype?: string; commands?: unknown } | null
  if (record?.type !== 'system' || record.subtype !== 'commands_changed' || !Array.isArray(record.commands)) return
  overrides.delete(sessionId)
  overrides.set(sessionId, record.commands as SlashCommand[])
  while (overrides.size > MAX_SESSIONS) {
    const oldest = overrides.keys().next().value
    if (oldest === undefined) break
    overrides.delete(oldest)
  }
}

export function getClaudeCommandsOverride(sessionId: string): SlashCommand[] | undefined {
  return overrides.get(sessionId)
}
