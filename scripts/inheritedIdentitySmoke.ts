// Pins lib/inheritedIdentityEnv.mjs: what is removed, what is kept, and that
// every process entry point that can spawn an agent scrubs before it does.
// The teammate-level behaviour is pinned in scripts/coordWorkerSmoke.mjs.
import { readFileSync } from 'node:fs'
import {
  INHERITED_AGENT_IDENTITY_KEYS,
  INHERITED_TERMINAL_IDENTITY_KEYS,
  hostedTerminalEnv,
  scrubInheritedAgentIdentity,
} from '../lib/inheritedIdentityEnv.mjs'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const ordinary = { ANTHROPIC_API_KEY: 'key', DISPLAY: ':42', PATH: '/usr/bin', TERM: 'xterm-256color' }
const outerAgent = Object.fromEntries(INHERITED_AGENT_IDENTITY_KEYS.map((key) => [key, 'outer']))
const outerTerminal = Object.fromEntries(INHERITED_TERMINAL_IDENTITY_KEYS.map((key) => [key, 'outer']))

const env: Record<string, string | undefined> = { ...ordinary, ...outerAgent, ...outerTerminal }
const removed = scrubInheritedAgentIdentity(env)
assert(removed.length === INHERITED_AGENT_IDENTITY_KEYS.length, 'scrub did not report every key it removed')
for (const key of INHERITED_AGENT_IDENTITY_KEYS) assert(!(key in env), `${key} survived the scrub`)
for (const [key, value] of Object.entries(ordinary)) assert(env[key] === value, `${key} was not kept`)
// Agent Viewer's own terminal markers are how OpenTUI picks clipboard and
// passthrough behaviour for the user's real terminal; only a hosted PTY drops them.
for (const key of INHERITED_TERMINAL_IDENTITY_KEYS) assert(env[key] === 'outer', `${key} was removed from our own process`)
assert(scrubInheritedAgentIdentity(env).length === 0, 'a second scrub found something to remove')

const hosted = hostedTerminalEnv({ ...ordinary, ...outerAgent, ...outerTerminal, TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.5' })
for (const key of [...INHERITED_AGENT_IDENTITY_KEYS, ...INHERITED_TERMINAL_IDENTITY_KEYS, 'TERM_PROGRAM_VERSION']) {
  assert(!(key in hosted), `${key} reached a hosted terminal`)
}
assert(hosted.TERM_PROGRAM === 'agent-viewer', 'a hosted terminal did not identify as agent-viewer')
assert(hosted.ANTHROPIC_API_KEY === 'key' && hosted.DISPLAY === ':42', 'a hosted terminal lost an ordinary variable')

// Anti-drift: each way this app's processes start must scrub, or the SDK's
// default `process.env` hands the launcher's identity to every agent it spawns.
for (const entry of ['bin/agent-viewer.mjs', 'bin/agent-viewer-coord-worker.mjs', 'tui/opentui/main.tsx', 'instrumentation.ts']) {
  const source = readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8')
  assert(/^\s*scrubInheritedAgentIdentity\(\)/m.test(source), `${entry} does not scrub inherited agent identity`)
}
for (const pty of ['lib/terminalSession.ts', 'lib/ahpTerminals.ts']) {
  const source = readFileSync(new URL(`../${pty}`, import.meta.url), 'utf8')
  assert(source.includes('hostedTerminalEnv()'), `${pty} spawns a terminal without hostedTerminalEnv`)
}

console.log('inherited identity smoke passed')
