#!/usr/bin/env node

// `agent-viewer schedule <verb>` — recurring prompts, from a shell or another agent.
//
// Talks to a running `agent-viewer web` daemon over /api/schedules, like `session`.
// JSON on stdout; a failure is JSON on stderr with exit 1, a usage error exits 2.

export const SCHEDULE_CLI_VERBS = ['list', 'add', 'rm', 'run', 'pause', 'resume']

import { parseSessionCliArgs } from './agent-viewer-session-cli.mjs'

class UsageError extends Error {}

const USAGE = `Usage: agent-viewer schedule <verb> [options]

  list                                    Schedules, their next run and recent outcomes
  add (--every <n><m|h|d> | --cron "<expr>" [--tz <zone>]) <prompt...>
      (--session <id> --provider <p> | --new-cwd <dir> --provider <p>)
      [--name <n>] [--model <m>] [--overlap skip|queue] [--catch-up once|skip] [--expires-in <ms>]
                                          Prompt a session, or start a new one, on a schedule
  rm <id>                                 Delete a schedule (and its history)
  run <id>                                Fire it now, once
  pause <id> | resume <id>                Stop or restart firing

Options:
  --attach <url|port>   Daemon (default: AGENT_VIEWER_ATTACH, else 3000)
  --compact             One-line JSON (default when stdout is not a terminal)`

function normalizeUrl(value) {
  if (/^\d+$/.test(value)) return `http://127.0.0.1:${value}`
  return /^https?:\/\//.test(value) ? value.replace(/\/+$/, '') : `http://${value.replace(/\/+$/, '')}`
}

async function call(base, init) {
  const response = await fetch(`${base}/api/schedules`, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error ?? `schedules answered ${response.status}`)
  return body
}

const post = (base, payload) => call(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

/** "--every 30m" → a trigger; the daemon validates the rest. */
export function triggerFromFlags(flags) {
  if (flags.every !== undefined && flags.cron !== undefined) throw new UsageError('Give --every or --cron, not both.')
  if (flags.every !== undefined) {
    const match = /^(\d+)([smhdw])$/i.exec(String(flags.every))
    if (!match) throw new UsageError('--every takes a number and a unit, like 30s, 30m, 1h, 2d or 1w.')
    return { kind: 'every', amount: Number(match[1]), unit: match[2].toLowerCase() }
  }
  if (typeof flags.cron === 'string') return { kind: 'cron', expression: flags.cron, ...(typeof flags.tz === 'string' ? { timeZone: flags.tz } : {}) }
  throw new UsageError('A trigger is required: --every or --cron.')
}

export function actionFromFlags(flags) {
  if (typeof flags.provider !== 'string') throw new UsageError('--provider is required.')
  if (typeof flags.session === 'string') return { kind: 'prompt-session', sessionId: flags.session, provider: flags.provider }
  if (typeof flags.new_cwd === 'string') return { kind: 'new-session', provider: flags.provider, cwd: flags.new_cwd, ...(typeof flags.model === 'string' ? { model: flags.model } : {}) }
  throw new UsageError('A target is required: --session <id> or --new-cwd <dir>.')
}

export async function runScheduleCli(argv) {
  const { positionals, flags } = parseSessionCliArgs(argv, new Set(['compact']))
  const [verb, ...rest] = positionals
  if (!verb || flags.help || flags.h) { console.log(USAGE); return 0 }
  if (!SCHEDULE_CLI_VERBS.includes(verb)) throw new UsageError(`Unknown schedule verb: ${verb}`)
  const base = normalizeUrl(String(flags.attach ?? process.env.AGENT_VIEWER_ATTACH ?? '3000'))
  let result

  if (verb === 'list') {
    result = await call(base)
  } else if (verb === 'add') {
    const prompt = rest.join(' ').trim()
    if (!prompt) throw new UsageError('add needs the prompt to send.')
    const trigger = triggerFromFlags(flags)
    const action = actionFromFlags(flags)
    const expiresIn = flags.expires_in === undefined ? 0 : Number(flags.expires_in)
    if (!Number.isFinite(expiresIn) || expiresIn < 0) throw new UsageError('--expires-in must be a non-negative number of milliseconds.')
    result = await post(base, {
      action: 'create',
      schedule: {
        name: typeof flags.name === 'string' ? flags.name : prompt.slice(0, 40),
        trigger, action, prompt,
        ...(flags.overlap ? { overlap: flags.overlap } : {}),
        ...(flags.catch_up ? { catchUp: flags.catch_up } : {}),
        ...(expiresIn > 0 ? { expiresAt: Date.now() + expiresIn } : {}),
      },
    })
  } else {
    const id = rest[0]
    if (!id) throw new UsageError(`${verb} needs a schedule id.`)
    result = await post(base, { action: verb === 'rm' ? 'delete' : verb === 'run' ? 'run-now' : verb, id })
  }

  const compact = flags.compact || !process.stdout.isTTY
  console.log(compact ? JSON.stringify(result) : JSON.stringify(result, null, 2))
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runScheduleCli(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error) => {
      const usage = error instanceof UsageError
      console.error(usage ? `${error.message}\n\n${USAGE}` : JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
      process.exitCode = usage ? 2 : 1
    },
  )
}
