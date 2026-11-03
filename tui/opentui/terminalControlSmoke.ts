// Driving the TUI's terminals from outside: a real socket, a real PTY shell, the real CLI.
import assert from 'node:assert/strict'
import { readFileSync, statSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'avc-'))
process.env.AGENT_VIEWER_CONTROL_DIR = dir
const { startTerminalControl, parseKeySpec, encodeKeySpecs, respondToControlRequest } = await import('./terminalControl')
const { runTerminalCli, TERMINAL_CLI_VERBS, findControlSockets } = await import('../../bin/agent-viewer-terminal-cli.mjs')
const { startShell, getShells, resetShellsForTest } = await import('./shellStore')

// Keys.
assert.equal(encodeKeySpecs(['C-c'], false), '\x03')
assert.equal(encodeKeySpecs(['Up'], false), '\x1b[A'); assert.equal(encodeKeySpecs(['Up'], true), '\x1bOA')
assert.equal(encodeKeySpecs(['Enter'], false), '\r'); assert.equal(encodeKeySpecs(['Esc', 'Tab'], false), '\x1b\t')
assert.equal(encodeKeySpecs(['M-b'], false), '\x1bb'); assert.equal(encodeKeySpecs(['S-Tab'], false), '\x1b[Z')
assert.equal(encodeKeySpecs(['a', 'B'], false), 'aB')
assert.throws(() => parseKeySpec('Hyper'), /Unknown key/)

// The launcher mirrors the verb list.
const launcher = readFileSync(new URL('../../bin/agent-viewer.mjs', import.meta.url), 'utf8')
assert.deepEqual(JSON.parse(/const TERMINAL_CLI_VERBS = (\[[^\]]*\])/.exec(launcher)![1].replaceAll("'", '"')), TERMINAL_CLI_VERBS)

// A dead TUI's socket is cleaned, a live one is kept.
writeFileSync(join(dir, 'terminal-999999.sock'), '')
const control = await startTerminalControl(dir)
assert.equal(existsSync(join(dir, 'terminal-999999.sock')), false, 'a stale socket is removed')
assert.equal(statSync(dir).mode & 0o777, 0o700); assert.equal(statSync(control.socketPath).mode & 0o777, 0o600)
assert.equal(findControlSockets(dir).length, 1)

const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'avc-cwd-')))
const shellId = await startShell({ cwd, cols: 100, rows: 30, ownerId: 'ws' })

async function cli(...argv: string[]) {
  const lines: string[] = []
  const original = console.log
  console.log = (line: unknown) => { lines.push(String(line)) }
  try { const code = await runTerminalCli([...argv, '--compact']); return { code, out: lines.length ? JSON.parse(lines.join('\n')) : null } } finally { console.log = original }
}
async function until(check: () => Promise<boolean>, what: string, ms = 8000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 100)) }
  throw new Error(`timed out: ${what}`)
}
const screen = async (...extra: string[]) => ((await cli('read', shellId, ...extra)).out.lines as string[]).join('\n')

try {
  const listed = (await cli('list')).out.terminals
  assert.equal(listed.length, 1); assert.equal(listed[0].id, shellId); assert.equal(listed[0].kind, 'shell'); assert.equal(listed[0].cwd, cwd)

  // run: argv is quoted, so a value cannot become syntax.
  await until(async () => (await screen()).trim().length > 0, 'the shell drew a prompt')
  await cli('run', shellId, '--', 'echo', 'hello  world', '$(echo injected)')
  await until(async () => /hello  world \$\(echo injected\)/.test(await screen()), 'run output')
  assert.ok(!/\ninjected/.test(await screen()), 'the substitution did not run')

  // send --enter and keys.
  await cli('send', shellId, 'echo from-send', '--enter')
  await until(async () => /^from-send$/m.test(await screen()), 'send output')
  await cli('send', shellId, 'sleep 30')
  await cli('keys', shellId, 'Enter')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await cli('keys', shellId, 'C-c')
  await cli('run', shellId, '--command', 'echo after-interrupt')
  await until(async () => /^after-interrupt$/m.test(await screen()), 'C-c interrupted the sleep')

  // read --lines.
  assert.ok(((await cli('read', shellId, '--lines', '2')).out.lines as string[]).length <= 2)

  // An agent's screen is classified: a blocked Claude form.
  await cli('run', shellId, '--command', `printf 'output\\n──────────────\\n Enter to select · ↑/↓ to navigate · Esc to cancel\\n'`)
  await until(async () => (await cli('list')).out.terminals[0].agentState === 'blocked', 'the agent state reads blocked')
  const blocked = await cli('wait', shellId, '--until', 'blocked', '--timeout', '3000')
  assert.equal(blocked.code, 0); assert.equal(blocked.out.agent, 'claude')
  const timedOut = await cli('wait', shellId, '--until', 'working', '--timeout', '700')
  assert.equal(timedOut.code, 3); assert.equal(timedOut.out.reached, false)

  // Refusals are errors, not silence.
  await assert.rejects(cli('read', 'shell-nope'), /No terminal/)
  await assert.rejects(cli('keys', shellId, 'Hyper'), /Unknown key/)
  await assert.rejects(cli('run', shellId, '--command', 'a\nb'), /one line/)
  await assert.rejects(cli('wait', shellId, '--until', 'bogus'), /--until must be/)
  assert.deepEqual(await respondToControlRequest('{nope'), { ok: false, error: 'request is not valid JSON' })

  // exited.
  await cli('run', shellId, '--command', 'exit')
  assert.equal((await cli('wait', shellId, '--until', 'exited', '--timeout', '8000')).code, 0)
  await assert.rejects(cli('send', shellId, 'x'), /not running/)
  console.log('terminalControlSmoke ok')
} finally {
  control.close()
  await resetShellsForTest()
  void getShells
}
