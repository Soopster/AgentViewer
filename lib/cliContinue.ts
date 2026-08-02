import type { AgentProvider } from './types'

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

// Verified against each CLI's installed --help output:
//   claude   --resume <id>            (claude --help)
//   codex    resume <id>              (codex resume --help; subcommand, not a flag)
//   opencode --session <id>           (opencode --help)
//   pi       --session <id>           (pi --help; loads an existing session by id/path,
//                                       unlike --session-id which creates one if missing)
//   copilot  --resume=<id>            (copilot --help)
const RESUME_COMMAND: Record<AgentProvider, (sessionId: string) => string> = {
  claude: (id) => `claude --resume ${id}`,
  codex: (id) => `codex resume ${id}`,
  opencode: (id) => `opencode --session ${id}`,
  pi: (id) => `pi --session ${id}`,
  copilot: (id) => `copilot --resume=${id}`,
}

export function getContinueInCliCommand(
  provider: AgentProvider,
  sessionId: string,
  cwd?: string | null,
): string | null {
  const build = RESUME_COMMAND[provider]
  if (!build) return null
  const resume = build(sessionId)
  return cwd ? `cd ${shellQuote(cwd)} && ${resume}` : resume
}
