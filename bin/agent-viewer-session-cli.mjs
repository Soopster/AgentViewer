#!/usr/bin/env node

// `agent-viewer session <verb>` — ordinary chats for a shell script or another agent.
//
// herdr's `agent list|read|prompt --wait|wait --until` for this app's sessions.
// Talks to a running `agent-viewer web` daemon over the routes the web UI uses.
// JSON on stdout; a failure is JSON on stderr with exit 1, a usage error exits 2,
// and a `wait` that timed out exits 3 (the same codes as `coord`).

export const SESSION_CLI_VERBS = ['list', 'get', 'read', 'prompt', 'wait', 'interrupt', 'report', 'explain']

const WAIT_STATES = ['working', 'blocked', 'idle']
const POLL_MS = 1000
const EXIT_TIMEOUT = 3

import { readFileSync } from 'node:fs'
import { classifyAnyAgent, explainScreen, findAgentManifest } from '../lib/terminalAgentDetect.mjs'

class UsageError extends Error {}

const USAGE = `Usage: agent-viewer session <verb> [options]

  list [--provider <p>] [--limit <n>]     Sessions this daemon lists
  get <id> [--provider <p>]               State: working | blocked | idle, and what it waits on
  read <id> [--tail <n>] [--provider <p>] The last n messages (default 20)
  prompt <id> <text> [--wait] [--timeout <ms>] [--provider <p>]
                                          Send a turn; --wait returns once it ends
  wait <id> --until working|blocked|idle [--timeout <ms>] [--provider <p>]
                                          Exit 0 when reached, 3 on timeout
  interrupt <id> [--provider <p>]         Stop the running turn
  report --state working|blocked|idle --source <name> [--session <id>] [--seq <n>] [--ttl <ms>]
                                          An agent that is not an SDK provider says what it is
                                          doing (from a hook); a report lapses after --ttl
  explain --file <path|-> [--agent claude|codex] [--title <t>]
                                          Why a saved terminal screen reads as working/blocked/idle

<id> may be "current" when AGENT_VIEWER_SESSION_ID is set.

Options:
  --attach <url|port>   Daemon (default: AGENT_VIEWER_ATTACH, else 3000)
  --compact             One-line JSON (default when stdout is not a terminal)`

function normalizeUrl(value) {
  if (/^\d+$/.test(value)) return `http://127.0.0.1:${value}`
  return /^https?:\/\//.test(value) ? value.replace(/\/+$/, '') : `http://${value.replace(/\/+$/, '')}`
}

export function parseSessionCliArgs(argv, booleans = new Set(['wait', 'compact'])) {
  const positionals = []
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--') || arg === '--') { positionals.push(arg); continue }
    const equals = arg.indexOf('=')
    const key = (equals > 0 ? arg.slice(2, equals) : arg.slice(2)).replace(/-/g, '_')
    if (equals > 0) { flags[key] = arg.slice(equals + 1); continue }
    const next = argv[index + 1]
    if (booleans.has(key) || next === undefined || next.startsWith('--')) { flags[key] = true; continue }
    flags[key] = next
    index += 1
  }
  return { positionals, flags }
}

/** working while a turn runs, blocked while it waits on the user, otherwise idle. */
export function classifySessionState(running) {
  const blockedOn = [
    ...(running?.pendingPermissions ?? []).map(() => 'permission'),
    ...(running?.pendingPrompts ?? []).map(() => 'question'),
  ]
  if (blockedOn.length > 0) return { state: 'blocked', waitingOn: blockedOn }
  return { state: running?.running ? 'working' : 'idle', waitingOn: [] }
}

function sessionId(positional) {
  if (!positional) throw new UsageError('A session id is required.')
  if (positional !== 'current') return positional
  const current = process.env.AGENT_VIEWER_SESSION_ID
  if (!current) throw new UsageError('"current" needs AGENT_VIEWER_SESSION_ID in the environment.')
  return current
}

function numberFlag(flags, name, fallback) {
  if (flags[name] === undefined) return fallback
  const value = Number(flags[name])
  if (!Number.isFinite(value) || value < 0) throw new UsageError(`--${name} must be a non-negative number.`)
  return value
}

async function request(base, path, init) {
  const response = await fetch(`${base}${path}`, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body?.error ?? `${init?.method ?? 'GET'} ${path} answered ${response.status}`)
  }
  return response
}

const json = async (base, path, init) => (await request(base, path, init)).json()

function providerQuery(flags) {
  return typeof flags.provider === 'string' ? `provider=${encodeURIComponent(flags.provider)}` : ''
}

async function readState(base, id, flags) {
  const query = providerQuery(flags)
  const running = await json(base, `/api/sessions/${encodeURIComponent(id)}/running${query ? `?${query}` : ''}`)
  const computed = { sessionId: id, ...classifySessionState(running), provider: running.provider ?? flags.provider ?? null }
  // A question or approval an SDK turn is blocked on is the truth; otherwise an
  // agent that reports itself (a hook in a non-SDK agent) says what it is doing.
  if (computed.state === 'blocked') return computed
  const reports = await json(base, `/api/sessions/reports?sessionId=${encodeURIComponent(id)}`).catch(() => ({ reports: [] }))
  const reported = reports.reports?.[0]
  return reported ? { ...computed, state: reported.state, reportedBy: reported.source } : computed
}

/** Poll until `until` holds. "idle" and "blocked" are matched on state alone. */
async function waitForState(base, id, until, timeoutMs, flags) {
  const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity
  for (;;) {
    const state = await readState(base, id, flags)
    if (state.state === until) return { reached: true, ...state }
    if (Date.now() >= deadline) return { reached: false, ...state }
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
}

async function runPrompt(base, id, text, flags) {
  const body = JSON.stringify({ message: text, ...(typeof flags.provider === 'string' ? { provider: flags.provider } : {}) })
  const controller = new AbortController()
  const response = await request(base, `/api/sessions/${encodeURIComponent(id)}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal,
  })
  if (!flags.wait) {
    // The turn runs server-side and survives this client going away.
    controller.abort()
    return { sessionId: id, sent: true }
  }
  const timeoutMs = numberFlag(flags, 'timeout', 0)
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    // Drain the stream; it closes when the turn ends.
    for await (const chunk of response.body) void chunk
  } catch (error) {
    if (!controller.signal.aborted) throw error
    return { sessionId: id, sent: true, ended: false, timedOut: true }
  } finally {
    if (timer) clearTimeout(timer)
  }
  return { sessionId: id, sent: true, ended: true, ...(await readState(base, id, flags)) }
}

export async function runSessionCli(argv) {
  const { positionals, flags } = parseSessionCliArgs(argv)
  const [verb, ...rest] = positionals
  if (!verb || flags.help || flags.h) { console.log(USAGE); return 0 }
  if (!SESSION_CLI_VERBS.includes(verb)) throw new UsageError(`Unknown session verb: ${verb}`)
  const base = normalizeUrl(String(flags.attach ?? process.env.AGENT_VIEWER_ATTACH ?? '3000'))
  const query = providerQuery(flags)
  let result
  let code = 0

  if (verb === 'list') {
    const params = new URLSearchParams()
    if (typeof flags.provider === 'string') params.set('provider', flags.provider)
    if (flags.limit !== undefined) params.set('limit', String(numberFlag(flags, 'limit', 50)))
    result = await json(base, `/api/sessions${params.size ? `?${params}` : ''}`)
  } else if (verb === 'get') {
    result = await readState(base, sessionId(rest[0]), flags)
  } else if (verb === 'read') {
    const id = sessionId(rest[0])
    const tail = numberFlag(flags, 'tail', 20)
    result = await json(base, `/api/sessions/${encodeURIComponent(id)}/messages?tail=1&limit=${tail}${query ? `&${query}` : ''}`)
  } else if (verb === 'prompt') {
    const id = sessionId(rest[0])
    const text = rest.slice(1).join(' ').trim()
    if (!text) throw new UsageError('prompt needs the text to send.')
    result = await runPrompt(base, id, text, flags)
    if (result.timedOut) code = EXIT_TIMEOUT
  } else if (verb === 'wait') {
    const until = String(flags.until ?? '')
    if (!WAIT_STATES.includes(until)) throw new UsageError(`--until must be one of ${WAIT_STATES.join(', ')}.`)
    result = await waitForState(base, sessionId(rest[0]), until, numberFlag(flags, 'timeout', 0), flags)
    if (!result.reached) code = EXIT_TIMEOUT
  } else if (verb === 'report') {
    if (!['working', 'blocked', 'idle'].includes(String(flags.state))) throw new UsageError('--state must be working, blocked or idle.')
    if (typeof flags.source !== 'string') throw new UsageError('--source <name> is required.')
    const session = typeof flags.session === 'string' ? sessionId(flags.session) : null
    result = await json(base, '/api/sessions/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: flags.source, state: flags.state, sessionId: session,
        ...(flags.seq !== undefined ? { seq: numberFlag(flags, 'seq', 0) } : {}),
        ...(flags.ttl !== undefined ? { ttlMs: numberFlag(flags, 'ttl', 0) } : {}),
      }),
    })
  } else if (verb === 'explain') {
    // Offline: no daemon. A saved screen (or `-` for stdin) and, optionally, the agent it came from.
    if (typeof flags.file !== 'string') throw new UsageError('--file <path|-> is required.')
    const text = readFileSync(flags.file === '-' ? 0 : flags.file, 'utf8')
    const screen = { lines: text.replace(/\r?\n$/, '').split(/\r?\n/), ...(typeof flags.title === 'string' ? { title: flags.title } : {}) }
    if (typeof flags.agent === 'string') {
      const manifest = findAgentManifest(flags.agent)
      if (!manifest) throw new UsageError(`Unknown agent: ${flags.agent}`)
      result = { agent: manifest.id, ...explainScreen(manifest, screen) }
    } else {
      const found = classifyAnyAgent(screen)
      result = found ? { agent: found.agent, ...explainScreen(findAgentManifest(found.agent), screen) } : { agent: null, winner: { state: 'unknown', ruleId: null }, matched: [] }
    }
  } else {
    const id = sessionId(rest[0])
    result = await json(base, `/api/sessions/${encodeURIComponent(id)}/interrupt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(typeof flags.provider === 'string' ? { provider: flags.provider } : {}),
    })
  }

  const compact = flags.compact || !process.stdout.isTTY
  console.log(compact ? JSON.stringify(result) : JSON.stringify(result, null, 2))
  return code
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSessionCli(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error) => {
      const usage = error instanceof UsageError
      console.error(usage ? `${error.message}\n\n${USAGE}` : JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      process.exitCode = usage ? 2 : 1
    },
  )
}
