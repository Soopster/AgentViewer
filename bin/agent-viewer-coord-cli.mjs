#!/usr/bin/env node

// `agent-viewer coord <verb>` — the Coordinator for a shell script or CI job.
//
// Everything an agent can do through the coord_* MCP tools, a script can do
// here: the verbs below are the common ones, and `call` reaches every tool in
// the shared contract, so a new tool is scriptable the day it exists. Output is
// JSON on stdout; a failure is JSON on stderr with exit 1, and a usage error
// exits 2. The capability token is saved 0600 and never printed.

import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { COORD_TOOL_SPECS } from '../lib/coordinatorToolContract.mjs'
import { callerAgentProvider } from '../lib/inheritedIdentityEnv.mjs'
import { COORDINATOR_KEYED_ACTIONS } from './agent-viewer-coordinator-tools.mjs'
import { coordinatorStateRoot } from './agent-viewer-coord-state.mjs'

const PROVIDERS = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'acp']
const EXTERNAL_COORD_PROTOCOL_VERSION = 2
const KEYED_ACTIONS = new Set(COORDINATOR_KEYED_ACTIONS)
// The server holds a wait for at most this long; a longer one is a loop of them.
const WAIT_SLICE_MS = 55_000

export const COORD_CLI_VERBS = ['run', 'join', 'runs', 'whoami', 'status', 'delegate', 'send', 'inbox', 'wait', 'tools', 'call']

class UsageError extends Error {}

const USAGE = `Usage: agent-viewer coord <verb> [options]

Start or join (binds this directory to a participant):
  run <goal> [--name <n>] [--provider <p>] [--cwd <dir>] [--max-agents <n>]
             [--playbook <name>] [--args <json>] [--gate-command <cmd>]
  join [<run-id>] --name <n> [--provider <p>] [--cwd <dir>]

Drive the bound run:
  status                               Board, roster, locks and the actionable digest
  delegate <title> [--detail <text>] [--to <teammate>] [--name <new teammate>]
           [--paths a,b] [--provider <p>] [--model <id>] [--wait-ms <n>]
  send <to> <message> [--reply-required] [--kind <k>] [--priority <p>]
  inbox [--peek]                       Read mail; --peek leaves it unacknowledged
  wait [--agent <name>] [--until idle,blocked,...] [--timeout <ms>]
                                       Exit 0 on a change, 3 on timeout
  call <tool> [<json>] [--<field> <value> ...]
                                       Any coord_* tool; \`tools\` lists them

Inspect:
  runs [--limit <n>]                   Runs this daemon knows
  whoami                               The participant this directory is bound to
  tools                                Every scriptable tool and its fields

Common options:
  --attach <url|port>    Daemon to talk to (default: AGENT_VIEWER_ATTACH, else 3000)
  --identity <file>      Use this saved participant instead of the directory's
  --compact              One-line JSON (the default when stdout is not a terminal)

A daemon must be running: \`agent-viewer daemon start\` runs one in the background.`

function normalizeUrl(value) {
  if (/^\d+$/.test(value)) return `http://127.0.0.1:${value}`
  return /^https?:\/\//.test(value) ? value.replace(/\/+$/, '') : `http://${value.replace(/\/+$/, '')}`
}

/** Split argv into positionals and --flags. A flag in `booleans` takes no value. */
export function parseCoordCliArgs(argv, booleans = new Set()) {
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

/** Coerce a flag's text to the type the tool contract declares for that field. */
export function coerceToolArgs(spec, raw) {
  const args = {}
  for (const [key, value] of Object.entries(raw)) {
    const field = spec.fields[key]
    if (!field) throw new UsageError(`${spec.name} has no field "${key}". Fields: ${Object.keys(spec.fields).join(', ') || '(none)'}`)
    if (typeof value !== 'string' && value !== true) { args[key] = value; continue }
    if (field.t === 'boolean') args[key] = value === true || value === 'true'
    else if (value === true) throw new UsageError(`--${key.replace(/_/g, '-')} requires a value`)
    else if (field.t === 'number') {
      const number = Number(value)
      if (!Number.isFinite(number)) throw new UsageError(`--${key.replace(/_/g, '-')} must be a number`)
      args[key] = number
    } else if (field.t === 'stringArray') args[key] = value.split(',').map((part) => part.trim()).filter(Boolean)
    else if (field.t === 'string' || field.t === 'enum') args[key] = value
    else {
      // Structured fields (decisions, receipts) are JSON on the command line.
      try { args[key] = JSON.parse(value) } catch { throw new UsageError(`--${key.replace(/_/g, '-')} must be JSON`) }
    }
  }
  const missing = Object.entries(spec.fields).filter(([key, field]) => !field.optional && args[key] === undefined).map(([key]) => key)
  if (missing.length) throw new UsageError(`${spec.name} requires: ${missing.join(', ')}`)
  return args
}

function toolSpec(name) {
  const full = name.startsWith('coord_') ? name : `coord_${name.replace(/-/g, '_')}`
  const spec = COORD_TOOL_SPECS.find((entry) => entry.name === full)
  if (!spec) throw new UsageError(`Unknown Coordinator tool: ${name}. Run \`agent-viewer coord tools\`.`)
  return spec
}

// One participant per directory: a script run from a checkout keeps addressing
// the run it started there without threading an identity file through.
function directoryBindingPath(cwd) {
  return path.join(coordinatorStateRoot(), 'cli', `${createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 32)}.json`)
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return null }
}

async function writePrivateJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
}

async function resolveIdentity(flags, cwd) {
  const explicit = typeof flags.identity === 'string' ? flags.identity : process.env.AGENT_VIEWER_COORD_IDENTITY_FILE?.trim()
  if (explicit) {
    const saved = await readJson(path.resolve(explicit))
    if (!saved?.runId || !saved?.agentId || !saved?.token) throw new Error(`No usable participant in ${explicit}`)
    return { identity: { runId: saved.runId, agentId: saved.agentId, token: saved.token }, identityFile: path.resolve(explicit), attach: saved.attach }
  }
  const runId = process.env.AGENT_VIEWER_COORD_RUN_ID?.trim()
  const agentId = process.env.AGENT_VIEWER_COORD_AGENT_ID?.trim()
  const token = process.env.AGENT_VIEWER_COORD_TOKEN?.trim()
  if (runId && agentId && token) return { identity: { runId, agentId, token } }
  const binding = await readJson(directoryBindingPath(cwd))
  const saved = binding?.identityFile ? await readJson(binding.identityFile) : null
  if (!saved?.runId || !saved?.agentId || !saved?.token) {
    throw new Error('This directory is not bound to a Coordinator run. Start one with `agent-viewer coord run "<goal>"`, join one with `agent-viewer coord join --name <n>`, or pass --identity <file>.')
  }
  return { identity: { runId: saved.runId, agentId: saved.agentId, token: saved.token }, identityFile: binding.identityFile, attach: binding.attach }
}

async function request(baseUrl, action, body, timeoutMs = 15_000) {
  let response
  try {
    response = await fetch(`${baseUrl}/api/agent-protocol/external`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new Error(`Could not reach an agent-viewer daemon at ${baseUrl} (${error instanceof Error ? error.message : String(error)}). Start one in the background with \`agent-viewer daemon start\`, or pass --attach <url|port>.`)
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `${response.status} ${response.statusText}`)
  return payload
}

// `bindDir` is where the command was typed, never `--cwd`: that names the
// checkout the participant works in, and a teammate joining with the lead's
// checkout as --cwd used to overwrite the lead's binding — every later command
// the lead typed ran as the teammate.
async function bind(result, baseUrl, bindDir, { keepSameRun = false } = {}) {
  const participant = result?.participant
  if (!participant?.runId || !participant?.agentId || !participant?.token) return result
  const identityFile = path.join(coordinatorStateRoot(), participant.runId, `${participant.agentId}.json`)
  await writePrivateJson(identityFile, { runId: participant.runId, agentId: participant.agentId, token: participant.token, attach: baseUrl })
  const shown = { ...result, participant: { ...participant, token: undefined }, identityFile }
  // Two agents in one repository is the ordinary case. A join must not take
  // the directory from another participant of the same run; it is told how to
  // address itself instead.
  if (keepSameRun) {
    const current = await readJson(directoryBindingPath(bindDir))
    const holder = current?.identityFile ? await readJson(current.identityFile) : null
    if (holder?.runId === participant.runId && holder.agentId !== participant.agentId) {
      return { ...shown, directoryBinding: 'kept', hint: `This directory stays bound to ${holder.agentId}. Pass --identity ${JSON.stringify(identityFile)} (or export AGENT_VIEWER_COORD_IDENTITY_FILE) on every command as this participant.` }
    }
  }
  await writePrivateJson(directoryBindingPath(bindDir), { identityFile, attach: baseUrl })
  return shown
}

function negotiation() {
  return {
    client: { name: 'agent-viewer-coord-cli', version: '1.0.0', protocolVersion: EXTERNAL_COORD_PROTOCOL_VERSION },
    capabilities: { unattended: false, sessionResume: true, maxParallelTasks: 1, tools: COORD_TOOL_SPECS.map((spec) => spec.name) },
  }
}

export async function runCoordCli(argv, io = { cwd: process.cwd(), stdout: process.stdout }) {
  const verb = argv[0]
  if (!verb || verb === '-h' || verb === '--help') return { text: USAGE }
  if (!COORD_CLI_VERBS.includes(verb)) throw new UsageError(`Unknown coord verb: ${verb}`)
  const { positionals, flags } = parseCoordCliArgs(argv.slice(1), new Set(['compact', 'peek', 'reply_required', 'help']))
  if (flags.help) return { text: USAGE }
  const compact = flags.compact === true
  for (const key of ['compact', 'help']) delete flags[key]
  const take = (key) => { const value = flags[key]; delete flags[key]; return value }
  const cwd = path.resolve(typeof flags.cwd === 'string' ? flags.cwd : io.cwd)
  const bindDir = path.resolve(io.cwd)
  const attachFlag = take('attach')
  const identityFlag = take('identity')
  const baseFor = (saved) => normalizeUrl(String(typeof attachFlag === 'string' ? attachFlag : process.env.AGENT_VIEWER_ATTACH?.trim() || saved || '3000'))
  const bound = async () => {
    const resolved = await resolveIdentity({ identity: identityFlag }, bindDir)
    return { ...resolved, baseUrl: baseFor(resolved.attach) }
  }
  const callTool = async (spec, raw) => {
    const { identity, baseUrl } = await bound()
    const body = { ...identity, ...spec.mapArgs(coerceToolArgs(spec, raw)) }
    if (KEYED_ACTIONS.has(spec.action) && !body.requestId) body.requestId = `cli-${randomUUID()}`
    return request(baseUrl, spec.action, body, body.waitMs || spec.action === 'wait' ? 65_000 : 15_000)
  }
  const noStray = (allowed = 0) => {
    if (positionals.length > allowed) throw new UsageError(`Unexpected argument: ${positionals[allowed]}`)
  }

  if (verb === 'tools') {
    noStray()
    return { json: COORD_TOOL_SPECS.map((spec) => ({
      tool: spec.name,
      fields: Object.fromEntries(Object.entries(spec.fields).map(([key, field]) => [key, `${field.t}${field.optional ? '?' : ''}`])),
      description: spec.description.split('. ')[0],
    })), compact }
  }
  if (verb === 'run' || verb === 'join') {
    // Claude Code and Codex mark the shells they run; anything else must say what it is.
    const provider = take('provider') ?? callerAgentProvider()
    if (provider !== undefined && !PROVIDERS.includes(provider)) throw new UsageError(`--provider must be one of ${PROVIDERS.join(', ')}`)
    const name = take('name')
    take('cwd')
    const baseUrl = baseFor()
    if (verb === 'join') {
      noStray(1)
      if (typeof name !== 'string') throw new UsageError('join requires --name <n>')
      const payload = { runId: positionals[0], name, provider: provider ?? 'codex', cwd, ...negotiation() }
      if (Object.keys(flags).length) throw new UsageError(`Unknown option: --${Object.keys(flags)[0].replace(/_/g, '-')}`)
      return { json: await bind(await request(baseUrl, 'join_run', payload), baseUrl, bindDir, { keepSameRun: true }), compact }
    }
    noStray(1)
    const playbookName = take('playbook')
    const rawArgs = take('args')
    const maxAgents = take('max_agents')
    const gateCommand = take('gate_command')
    if (!positionals[0] && typeof playbookName !== 'string') throw new UsageError('run requires a goal, or --playbook <name>')
    let playbookArgs
    if (typeof rawArgs === 'string') { try { playbookArgs = JSON.parse(rawArgs) } catch { throw new UsageError('--args must be JSON') } }
    if (Object.keys(flags).length) throw new UsageError(`Unknown option: --${Object.keys(flags)[0].replace(/_/g, '-')}`)
    return { json: await bind(await request(baseUrl, 'create_run', {
      prompt: positionals[0],
      name: typeof name === 'string' ? name : 'cli-lead',
      provider: provider ?? 'codex',
      maxAgents: maxAgents === undefined ? undefined : Number(maxAgents),
      cwd,
      gateCommand: typeof gateCommand === 'string' ? gateCommand : undefined,
      playbookName: typeof playbookName === 'string' ? playbookName : undefined,
      args: playbookArgs,
      ...negotiation(),
    }), baseUrl, bindDir), compact }
  }
  if (verb === 'runs') {
    noStray()
    const limit = take('limit')
    return { json: await request(baseFor(), 'list_runs', { limit: limit === undefined ? 20 : Number(limit) }), compact }
  }
  if (verb === 'whoami') {
    noStray()
    const { identity, identityFile, baseUrl } = await bound()
    return { json: { runId: identity.runId, agentId: identity.agentId, identityFile, attach: baseUrl }, compact }
  }
  if (verb === 'status') { noStray(); return { json: await callTool(toolSpec('status'), flags), compact } }
  if (verb === 'inbox') {
    noStray()
    const peek = take('peek')
    return { json: await callTool(toolSpec('read_inbox'), { ...flags, ...(peek ? { acknowledge: false } : {}) }), compact }
  }
  if (verb === 'send') {
    noStray(2)
    if (positionals.length < 2) throw new UsageError('send requires <to> <message>')
    return { json: await callTool(toolSpec('send_message'), { ...flags, to: positionals[0], message: positionals[1] }), compact }
  }
  if (verb === 'delegate') {
    noStray(1)
    if (!positionals[0]) throw new UsageError('delegate requires a title')
    const provider = take('provider')
    const model = take('model')
    return { json: await callTool(toolSpec('delegate'), {
      detail: positionals[0],
      ...flags,
      title: positionals[0],
      ...(provider === undefined ? {} : { requested_provider: provider }),
      ...(model === undefined ? {} : { requested_model: model }),
    }), compact }
  }
  if (verb === 'wait') {
    noStray()
    const timeout = take('timeout')
    const total = timeout === undefined ? Infinity : Number(timeout)
    if (Number.isNaN(total) || total < 0) throw new UsageError('--timeout must be a number of milliseconds')
    const spec = toolSpec('wait')
    const deadline = Date.now() + total
    let cursor = typeof flags.cursor === 'string' ? flags.cursor : undefined
    if (cursor === undefined) cursor = (await callTool(toolSpec('status'), {})).cursor
    for (;;) {
      const slice = Math.max(0, Math.min(WAIT_SLICE_MS, deadline - Date.now()))
      const result = await callTool(spec, { ...flags, ...(cursor ? { cursor } : {}), timeout_ms: slice })
      if (result.changed) return { json: result, compact }
      cursor = result.cursor ?? cursor
      if (Date.now() >= deadline) return { json: result, compact, exitCode: 3 }
    }
  }
  // call <tool> [json] [--field value ...]
  if (!positionals[0]) throw new UsageError('call requires a tool name')
  noStray(2)
  let inline = {}
  if (positionals[1] !== undefined) {
    try { inline = JSON.parse(positionals[1]) } catch { throw new UsageError('The argument after the tool name must be a JSON object') }
    if (!inline || typeof inline !== 'object' || Array.isArray(inline)) throw new UsageError('The argument after the tool name must be a JSON object')
  }
  return { json: await callTool(toolSpec(positionals[0]), { ...inline, ...flags }), compact }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
if (invokedDirectly) {
  try {
    const result = await runCoordCli(process.argv.slice(2))
    if (result.text) console.log(result.text)
    else console.log(JSON.stringify(result.json, null, result.compact || !process.stdout.isTTY ? undefined : 2))
    process.exitCode = result.exitCode ?? 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ error: message }))
    process.exitCode = error instanceof UsageError ? 2 : 1
  }
}
