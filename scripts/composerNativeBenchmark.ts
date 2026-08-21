import { spawn } from 'node:child_process'

import type { AgentProvider } from '../lib/types'

type Target = { provider: AgentProvider; sessionId: string }
type Sample = Target & {
  surface: 'native-cli'
  run: number
  firstEventMs: number | null
  completeMs: number
  ok: boolean
  error?: string
}

const PROVIDERS: AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi']
const rawArgs = process.argv.slice(2)
const args = new Map(rawArgs.flatMap((arg) => {
  const match = /^--([^=]+)=(.*)$/.exec(arg)
  return match ? [[match[1]!, match[2]!] as const] : []
}))

if (rawArgs.includes('--help')) {
  console.log([
    'Usage: AGENT_VIEWER_ALLOW_LIVE_BENCHMARK=1 npm run composer:benchmark:native -- \\',
    '  --runs=3 --cwd=/tmp --claude=<session-id> [--codex=<session-id> ...]',
    '',
    'Runs the same synthetic no-tools prompt through installed native CLIs.',
    'Use dedicated benchmark sessions: every successful run appends a turn.',
  ].join('\n'))
  process.exit(0)
}

if (process.env.AGENT_VIEWER_ALLOW_LIVE_BENCHMARK !== '1') {
  throw new Error('Set AGENT_VIEWER_ALLOW_LIVE_BENCHMARK=1 to acknowledge that this sends synthetic prompts to configured providers.')
}

const runs = Math.max(1, Math.min(20, Number.parseInt(args.get('runs') ?? '3', 10) || 3))
const cwd = args.get('cwd')?.trim() || '/tmp'
const prompt = args.get('prompt') ?? 'Reply with exactly OK. Do not inspect files or use tools.'
const targets = PROVIDERS.flatMap((provider): Target[] => {
  const sessionId = args.get(provider)?.trim()
  return sessionId ? [{ provider, sessionId }] : []
})
if (targets.length === 0) {
  throw new Error(`Pass at least one dedicated provider session. Supported: ${PROVIDERS.join(', ')}`)
}

function commandFor(target: Target): { command: string; args: string[] } {
  switch (target.provider) {
    case 'claude':
      return {
        command: 'claude',
        args: ['-p', '--resume', target.sessionId, '--output-format', 'stream-json', '--include-partial-messages', '--permission-mode', 'dontAsk', prompt],
      }
    case 'codex':
      return {
        command: 'codex',
        args: ['exec', 'resume', target.sessionId, '--json', '--skip-git-repo-check', prompt],
      }
    case 'opencode':
      return {
        command: 'opencode',
        args: ['run', '--session', target.sessionId, '--format', 'json', '--dir', cwd, prompt],
      }
    case 'copilot':
      return {
        command: 'copilot',
        args: ['-p', prompt, '--session-id', target.sessionId, '--output-format', 'json', '--stream', 'on', '--no-ask-user', '--no-auto-update'],
      }
    case 'pi':
      return {
        command: 'pi',
        args: ['--session', target.sessionId, '--mode', 'json', '--no-approve', '-p', prompt],
      }
    case 'lmstudio':
      throw new Error('LM Studio has no native CLI to benchmark against — it is a local server only.')
    case 'claude-acp':
    case 'codex-acp':
      throw new Error('ACP-transport sessions are driven via claude-agent-acp/codex-acp subprocess RPC, not a native CLI invocation.')
  }
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!
}

async function runSample(target: Target, run: number): Promise<Sample> {
  const invocation = commandFor(target)
  const startedAt = performance.now()
  return new Promise((resolve) => {
    let firstEventMs: number | null = null
    let stderr = ''
    let settled = false
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const finish = (ok: boolean, error?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({
        ...target,
        surface: 'native-cli',
        run,
        firstEventMs,
        completeMs: performance.now() - startedAt,
        ok,
        ...(error ? { error } : {}),
      })
    }
    child.stdout.on('data', (chunk: Buffer) => {
      if (firstEventMs == null && chunk.length > 0) firstEventMs = performance.now() - startedAt
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 16_000) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => finish(false, error.message))
    child.on('close', (code, signal) => {
      const ok = code === 0
      finish(ok, ok ? undefined : (stderr.trim() || `Exited with ${code ?? signal ?? 'unknown status'}`))
    })
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish(false, 'Timed out after 5 minutes')
    }, 5 * 60 * 1000)
    if (typeof timeout === 'object' && 'unref' in timeout) timeout.unref()
  })
}

const samples: Sample[] = []
for (const target of targets) {
  for (let run = 1; run <= runs; run += 1) {
    const sample = await runSample(target, run)
    samples.push(sample)
    console.log(JSON.stringify({ type: 'sample', ...sample }))
  }
}

for (const target of targets) {
  const providerSamples = samples.filter((sample) => sample.provider === target.provider)
  const successful = providerSamples.filter((sample) => sample.ok)
  const firstEvents = successful.flatMap((sample) => sample.firstEventMs == null ? [] : [sample.firstEventMs])
  console.log(JSON.stringify({
    type: 'summary',
    surface: 'native-cli',
    provider: target.provider,
    runs: providerSamples.length,
    successes: successful.length,
    failures: providerSamples.length - successful.length,
    firstEventP50Ms: percentile(firstEvents, 0.5),
    firstEventP95Ms: percentile(firstEvents, 0.95),
    completionP50Ms: percentile(successful.map((sample) => sample.completeMs), 0.5),
    completionP95Ms: percentile(successful.map((sample) => sample.completeMs), 0.95),
  }))
}

if (samples.some((sample) => !sample.ok)) process.exitCode = 1
