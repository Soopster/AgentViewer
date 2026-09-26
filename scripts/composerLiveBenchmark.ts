import { randomUUID } from 'node:crypto'

import { BENCHMARK_CONTROL_EVENTS, isBenchmarkStartupPayload } from '../lib/composerBenchmarkComparison'
import type { AgentProvider } from '../lib/types'

type Target = { provider: AgentProvider; sessionId: string }
type Sample = Target & {
  surface: 'agentviewer'
  run: number
  ackMs: number
  firstEventMs: number | null
  completeMs: number
  ok: boolean
  error?: string
}

const PROVIDERS: AgentProvider[] = ['claude', 'codex', 'opencode', 'copilot', 'pi']
const args = new Map(process.argv.slice(2).flatMap((arg) => {
  const match = /^--([^=]+)=(.*)$/.exec(arg)
  return match ? [[match[1]!, match[2]!] as const] : []
}))
if (process.argv.includes('--help')) {
  console.log([
    'Usage: AGENT_VIEWER_ALLOW_LIVE_BENCHMARK=1 npm run composer:benchmark -- \\',
    '  --base-url=http://127.0.0.1:3000 --runs=3 --claude=<session-id> [--codex=<session-id> ...]',
    '',
    'The default synthetic prompt is: Reply with exactly OK. Do not inspect files or use tools.',
    'Each sample is emitted as JSON followed by per-provider p50/p95 and failure summaries.',
  ].join('\n'))
  process.exit(0)
}
const baseUrl = (args.get('base-url') ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const runs = Math.max(1, Math.min(20, Number.parseInt(args.get('runs') ?? '3', 10) || 3))
const prompt = args.get('prompt') ?? 'Reply with exactly OK. Do not inspect files or use tools.'
const targets = PROVIDERS.flatMap((provider): Target[] => {
  const sessionId = args.get(provider)?.trim()
  return sessionId ? [{ provider, sessionId }] : []
})

if (process.env.AGENT_VIEWER_ALLOW_LIVE_BENCHMARK !== '1') {
  throw new Error('Set AGENT_VIEWER_ALLOW_LIVE_BENCHMARK=1 to acknowledge that this sends synthetic prompts to configured providers.')
}
if (targets.length === 0) {
  throw new Error(`Pass at least one provider session, for example --claude=<session-id>. Supported: ${PROVIDERS.join(', ')}`)
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]!
}

function extractFrames(buffer: string): { frames: string[]; remaining: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const frames: string[] = []
  let start = 0
  while (true) {
    const boundary = normalized.indexOf('\n\n', start)
    if (boundary < 0) break
    frames.push(normalized.slice(start, boundary))
    start = boundary + 2
  }
  return { frames, remaining: normalized.slice(start) }
}

function isProviderEvent(frame: string): boolean {
  if (!frame || frame.startsWith(':')) return false
  const event = frame.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message'
  if (BENCHMARK_CONTROL_EVENTS.has(event)) return false
  const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
  return !isBenchmarkStartupPayload(data)
}

async function runSample(target: Target, run: number): Promise<Sample> {
  const startedAt = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000)
  let ackMs = 0
  let firstEventMs: number | null = null
  try {
    const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(target.sessionId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: target.provider,
        message: prompt,
        detachOnClientAbort: false,
        manualPermissions: false,
        turnRequestId: `benchmark-${randomUUID()}`,
      }),
      signal: controller.signal,
    })
    ackMs = performance.now() - startedAt
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    if (!response.body) throw new Error('No response stream')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const extracted = extractFrames(buffer)
      buffer = extracted.remaining
      if (firstEventMs == null && extracted.frames.some(isProviderEvent)) {
        firstEventMs = performance.now() - startedAt
      }
      const errorFrame = extracted.frames.find((frame) => frame.split('\n').some((line) => line.trim() === 'event: error'))
      if (errorFrame) throw new Error(errorFrame)
    }
    return { ...target, surface: 'agentviewer', run, ackMs, firstEventMs, completeMs: performance.now() - startedAt, ok: true }
  } catch (error) {
    return {
      ...target,
      surface: 'agentviewer',
      run,
      ackMs,
      firstEventMs,
      completeMs: performance.now() - startedAt,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
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
    surface: 'agentviewer',
    provider: target.provider,
    runs: providerSamples.length,
    successes: successful.length,
    failures: providerSamples.length - successful.length,
    ackP50Ms: percentile(successful.map((sample) => sample.ackMs), 0.5),
    ackP95Ms: percentile(successful.map((sample) => sample.ackMs), 0.95),
    firstEventP50Ms: percentile(firstEvents, 0.5),
    firstEventP95Ms: percentile(firstEvents, 0.95),
    completionP50Ms: percentile(successful.map((sample) => sample.completeMs), 0.5),
    completionP95Ms: percentile(successful.map((sample) => sample.completeMs), 0.95),
  }))
}

if (samples.some((sample) => !sample.ok)) process.exitCode = 1
