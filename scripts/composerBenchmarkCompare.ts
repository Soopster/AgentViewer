import { readFileSync } from 'node:fs'

import {
  compareComposerBenchmarks,
  DEFAULT_COMPOSER_BENCHMARK_THRESHOLDS,
  parseComposerBenchmarkSummaries,
} from '../lib/composerBenchmarkComparison'

const rawArgs = process.argv.slice(2)
const args = new Map(rawArgs.flatMap((arg) => {
  const match = /^--([^=]+)=(.*)$/.exec(arg)
  return match ? [[match[1]!, match[2]!] as const] : []
}))

if (rawArgs.includes('--help')) {
  console.log([
    'Usage: npm run composer:benchmark:compare -- \\',
    '  --agentviewer=/tmp/agentviewer.jsonl --native=/tmp/native.jsonl',
    '',
    'Default parity limits:',
    '  first-event p95 <= native * 1.15 + 50ms',
    '  completion p95  <= native * 1.10 + 100ms',
    '  AgentViewer success rate >= native CLI success rate',
    '',
    'Override with --first-event-ratio, --first-event-slack-ms,',
    '--completion-ratio, or --completion-slack-ms.',
  ].join('\n'))
  process.exit(0)
}

function numericArg(name: string, fallback: number): number {
  const raw = args.get(name)
  if (raw == null) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a non-negative number`)
  return value
}

const agentViewerPath = args.get('agentviewer')
const nativePath = args.get('native')
if (!agentViewerPath || !nativePath) throw new Error('Pass --agentviewer=<jsonl> and --native=<jsonl>')

const thresholds = {
  firstEventRatio: numericArg('first-event-ratio', DEFAULT_COMPOSER_BENCHMARK_THRESHOLDS.firstEventRatio),
  firstEventSlackMs: numericArg('first-event-slack-ms', DEFAULT_COMPOSER_BENCHMARK_THRESHOLDS.firstEventSlackMs),
  completionRatio: numericArg('completion-ratio', DEFAULT_COMPOSER_BENCHMARK_THRESHOLDS.completionRatio),
  completionSlackMs: numericArg('completion-slack-ms', DEFAULT_COMPOSER_BENCHMARK_THRESHOLDS.completionSlackMs),
}
const comparisons = compareComposerBenchmarks(
  parseComposerBenchmarkSummaries(readFileSync(agentViewerPath, 'utf8'))
    .filter((summary) => summary.surface === 'agentviewer'),
  parseComposerBenchmarkSummaries(readFileSync(nativePath, 'utf8'))
    .filter((summary) => summary.surface === 'native-cli'),
  thresholds,
)

for (const comparison of comparisons) {
  console.log(JSON.stringify({ type: 'composer-benchmark-comparison', ...comparison }))
}
if (comparisons.some((comparison) => !comparison.passed)) process.exitCode = 1
