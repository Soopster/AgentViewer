import type { AgentProvider } from './types'

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

export function getContinueInCliCommand(
  provider: AgentProvider,
  sessionId: string,
  cwd?: string | null,
): string | null {
  if (provider === 'claude') {
    const resume = `claude --resume ${sessionId}`
    return cwd ? `cd ${shellQuote(cwd)} && ${resume}` : resume
  }
  if (provider === 'opencode') {
    // TODO: verify --session flag against opencode CLI docs
    return `opencode --session ${sessionId}`
  }
  return null
}
