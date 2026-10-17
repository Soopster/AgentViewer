// Environment markers that say which agent session or terminal a process
// belongs to. Agent Viewer is launched from inside those often — `npm run tui`
// typed into a Claude Code shell, `agent-viewer coord worker` run by a lead's
// Bash tool — and every agent it spawns would otherwise inherit them and claim
// the launching session as its own. Herdr fixed the same leak (#4461).
//
// Plain JS with no imports: the bin entrypoints run under vanilla node.

// What a Claude Code session exports to its tools (the CLI's own per-tool env),
// plus Codex's and OMP's equivalents. Measured on the bundled CLI: an inherited
// CLAUDE_CODE_ENTRYPOINT=cli turns an SDK teammate into `sdk-cli` instead of
// `sdk-ts`, CLAUDECODE / CLAUDE_CODE_CHILD_SESSION mark it a nested child of the
// launcher, and CLAUDE_EFFORT tells its hooks and Bash the launcher's effort.
export const INHERITED_AGENT_IDENTITY_KEYS = Object.freeze([
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'AI_AGENT',
  'CODEX_THREAD_ID',
  'OMPCODE',
])

// The outer terminal's session markers. Only a terminal we host (the embedded
// PTYs) must drop these: programs in it would otherwise believe they run in
// the user's iTerm2 or tmux pane and emit that terminal's private sequences.
export const INHERITED_TERMINAL_IDENTITY_KEYS = Object.freeze([
  'ITERM_SESSION_ID',
  'LC_TERMINAL',
  'LC_TERMINAL_VERSION',
  'TERM_SESSION_ID',
  'WEZTERM_PANE',
  'KITTY_WINDOW_ID',
  'WT_SESSION',
  'TMUX',
  'TMUX_PANE',
  'STY',
  'ZELLIJ',
  'ZELLIJ_SESSION_NAME',
  'ZELLIJ_PANE_ID',
])

/** Removes inherited agent-session markers from `env` in place; returns the keys removed. */
export function scrubInheritedAgentIdentity(env = process.env) {
  const removed = []
  for (const key of INHERITED_AGENT_IDENTITY_KEYS) {
    if (key in env) {
      delete env[key]
      removed.push(key)
    }
  }
  return removed
}

/**
 * A copy of `env` for a terminal this app hosts: no agent or outer-terminal
 * identity, and TERM_PROGRAM naming us. Explicit values set afterwards win.
 */
export function hostedTerminalEnv(env = process.env) {
  const next = { ...env }
  for (const key of INHERITED_AGENT_IDENTITY_KEYS) delete next[key]
  for (const key of INHERITED_TERMINAL_IDENTITY_KEYS) delete next[key]
  next.TERM_PROGRAM = 'agent-viewer'
  delete next.TERM_PROGRAM_VERSION
  return next
}
