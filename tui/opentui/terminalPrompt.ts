// The composer's other kind of target: a terminal. A prompt goes to a shell the
// way `agent-viewer terminal send` sends it (one bracketed paste when it spans
// lines, then Enter), and the targets on offer carry the state read off their
// screens so the user can see which agent is waiting before typing at it.

import { encodeTerminalPaste } from '../../lib/terminalKeys'

export type ComposerTerminal = { id: string; name: string; cwd: string; agent: string | null; agentState: string | null }

/** Text typed into a running shell: multi-line text is one paste, so it does not run line by line. */
export function encodeTerminalPrompt(text: string, bracketedPaste: boolean, enter: boolean): string {
  return (/\n/.test(text) ? encodeTerminalPaste(text, bracketedPaste) : text) + (enter ? '\r' : '')
}

/** Running shells, the state of any agent in them included. Loads the stores on first use. */
export async function listComposerTerminals(): Promise<ComposerTerminal[]> {
  const shells = await import('./shellStore')
  const { readShellAgentState } = await import('./shellAgentState')
  return shells.getShells().filter(shell => shell.status === 'running').map(shell => {
    const agent = readShellAgentState(shell)
    return { id: shell.id, name: shell.name, cwd: shell.cwd, agent: agent?.agent ?? null, agentState: agent?.state ?? null }
  })
}

export type TerminalPromptResult = { ok: true; agentState: string | null } | { ok: false; error: string }

/** Sends `text` to the shell and presses Enter. A shell that is gone is an error, never a silent drop. */
export async function sendTerminalPrompt(id: string, text: string): Promise<TerminalPromptResult> {
  const shells = await import('./shellStore')
  const { readShellAgentState } = await import('./shellAgentState')
  const shell = shells.getShells().find(entry => entry.id === id)
  if (!shell) return { ok: false, error: `${id} is no longer open` }
  if (shell.status !== 'running') return { ok: false, error: `${shell.name} is ${shell.status}` }
  const term = shells.shellTerminal(id)
  shells.writeShell(id, encodeTerminalPrompt(text, term?.bracketedPaste() ?? false, true))
  return { ok: true, agentState: readShellAgentState(shell)?.state ?? null }
}

export async function readTerminalAgentState(id: string): Promise<string | null> {
  const shells = await import('./shellStore')
  const { readShellAgentState } = await import('./shellAgentState')
  const shell = shells.getShells().find(entry => entry.id === id)
  return shell ? readShellAgentState(shell)?.state ?? null : null
}

/** What a blocked agent is waiting for is a keypress, not a prompt: a menu choice or yes/no is one key, and an empty submit accepts the default. */
export function terminalAnswerBytes(text: string): string | null {
  if (text === '') return '\r'
  return /^[1-9ynYN]$/.test(text) ? text : null
}

export async function sendTerminalAnswer(id: string, bytes: string): Promise<TerminalPromptResult> {
  const shells = await import('./shellStore')
  const shell = shells.getShells().find(entry => entry.id === id)
  if (!shell || shell.status !== 'running') return { ok: false, error: `${id} is not running` }
  shells.writeShell(id, bytes)
  return { ok: true, agentState: null }
}

const queued = new Map<string, { text: string; timer: ReturnType<typeof setInterval> }[]>()
const QUEUE_POLL_MS = 700

/** Holds a prompt until the agent in `id` is idle, then sends it. Prompts for one terminal go out in order, one per idle. */
export function queueTerminalPrompt(id: string, text: string, done: (result: TerminalPromptResult, text: string) => void): number {
  const line = queued.get(id) ?? []
  queued.set(id, line)
  const entry = { text, timer: setInterval(() => { void tick() }, QUEUE_POLL_MS) }
  let busy = false
  const tick = async () => {
    if (busy || line[0] !== entry) return
    busy = true
    try {
      const state = await readTerminalAgentState(id)
      // Only a positive idle answer releases it; the shell vanishing ends the wait with an error.
      if (state !== 'idle' && state !== 'done' && state !== null) return
      const result = await sendTerminalPrompt(id, text)
      clearInterval(entry.timer)
      line.shift()
      if (line.length === 0) queued.delete(id)
      done(result, text)
    } finally { busy = false }
  }
  line.push(entry)
  return line.length
}

export function cancelQueuedTerminalPrompts(id?: string): number {
  let count = 0
  for (const [key, line] of queued) {
    if (id && key !== id) continue
    for (const entry of line) { clearInterval(entry.timer); count += 1 }
    queued.delete(key)
  }
  return count
}

export function queuedTerminalPromptCount(id: string): number { return queued.get(id)?.length ?? 0 }

/** Sends what is queued for `id` now, in order, without waiting for idle. */
export async function releaseQueuedTerminalPrompts(id: string): Promise<number> {
  const line = queued.get(id) ?? []
  queued.delete(id)
  for (const entry of line) clearInterval(entry.timer)
  for (const entry of line) await sendTerminalPrompt(id, entry.text)
  return line.length
}

/** A terminal's handle in a prompt: its name lowercased with runs of non-word characters as `-`, so `Claude terminal` is `@claude-terminal`. */
export function terminalHandle(name: string): string {
  return name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'terminal'
}

export type TerminalAddressing = { targets: { id: string; name: string }[]; text: string }

/**
 * `@handle` words at the very start of a prompt address terminals ("@claude @codex run the tests"),
 * and are removed from what is sent. A handle is the terminal's handle, its id, or `@all` (every
 * terminal running a recognised agent); an unambiguous prefix of a handle also counts. The first word
 * that matches nothing ends the addressing and stays in the text, so a file mention such as
 * `@src/App.tsx` is never swallowed, and an ambiguous prefix addresses nothing rather than guess.
 */
export function parseTerminalAddressing(text: string, terminals: readonly ComposerTerminal[]): TerminalAddressing | null {
  const targets = new Map<string, { id: string; name: string }>()
  let rest = text.trimStart()
  for (;;) {
    const match = /^@([\p{L}\p{N}._#-]+)(?:\s+|$)/u.exec(rest)
    if (!match) break
    const word = match[1]!.toLowerCase()
    let found: readonly ComposerTerminal[]
    if (word === 'all') found = terminals.filter(terminal => terminal.agent)
    else {
      const exact = terminals.filter(terminal => terminalHandle(terminal.name) === word || terminal.id.toLowerCase() === word)
      const prefixed = exact.length > 0 ? exact : terminals.filter(terminal => terminalHandle(terminal.name).startsWith(word))
      found = prefixed.length === 1 || exact.length > 0 ? prefixed : []
    }
    if (found.length === 0) break
    for (const terminal of found) targets.set(terminal.id, { id: terminal.id, name: terminal.name })
    rest = rest.slice(match[0].length)
  }
  return targets.size === 0 ? null : { targets: [...targets.values()], text: rest.trim() }
}
