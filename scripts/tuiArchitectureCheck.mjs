import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Each native renderer gets its own process. Keep benchmarks sequential so
// overlapping scenes do not contaminate frame samples or resource ownership.
const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--report')) {
  console.error('Usage: npm run tui:architecture:check -- [--report path.json]')
  process.exit(1)
}
const configuredLimit = process.env.TUI_ARCHITECTURE_P95_MS
const frameP95LimitMs = configuredLimit === undefined ? null : Number(configuredLimit)
if (frameP95LimitMs !== null && (!Number.isFinite(frameP95LimitMs) || frameP95LimitMs <= 0)) {
  console.error('TUI_ARCHITECTURE_P95_MS must be a positive finite number')
  process.exit(1)
}
const bun = spawnSync('bun', ['--version'], { encoding: 'utf8' })
if (bun.status !== 0) {
  console.error('Bun is required for the OpenTUI architecture checks.')
  process.exit(1)
}
const smokeFiles = [
  'rowHeightIndexSmoke.ts',
  'sessionCacheBudgetSmoke.ts',
  'sessionIdentitySmoke.ts',
  'transcriptBrokerSmoke.ts',
  'transcriptSessionLoaderSmoke.ts',
  'transcriptDeliverySmoke.ts',
  'markdownBlocksQueueSmoke.ts',
  'markdownCodeQueueSmoke.ts',
  'markdownStructureSmoke.ts',
  'markdownBlocksSmoke.tsx',
  'markdownTableSelectionSmoke.tsx',
  'windowActivitySmoke.tsx',
  'windowChromeOwnerSmoke.tsx',
  'transcriptControllerSmoke.tsx',
  'transcriptWindowInputSmoke.ts',
  'providerInstanceWindowSmoke.tsx',
  'providerInstanceActivitySmoke.ts',
  'gitWindowActivitySmoke.tsx',
  'virtualTranscriptRowsSmoke.tsx',
  'readerTailLiveSmoke.tsx',
  'tabReaderPositionSmoke.tsx',
  'transcriptWindowParitySmoke.tsx',
  'transcriptLargeDiffSmoke.tsx',
  'transcriptLargeMarkdownSmoke.tsx',
  'transcriptStructuredMarkdownSmoke.ts',
  'gitDiffViewportSmoke.tsx',
  'engineeringShellSmoke.tsx',
]
const checks = [
  ['web-types', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['opentui-types', ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.opentui.json']],
  ...smokeFiles.map(file => [file, [`tui/opentui/${file}`]]),
]
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
const results = []
for (const [name, argv] of checks) {
  const start = performance.now()
  const run = spawnSync('bun', argv, {
    cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    // Always enforce native-node budgets, even in a caller's perf shell.
    env: { ...process.env, LARGE_DIFF_PERF: '0', STRUCTURED_MARKDOWN_PERF: '0',
      STRUCTURED_MARKDOWN_KIND: 'paragraph', STRUCTURED_MARKDOWN_ROWS: '', ENGINEERING_SHELL_CHILD_SIZE: '' },
  })
  const output = (run.stdout ?? '') + (run.stderr ?? '')
  const metrics = []
  for (const line of (run.stdout ?? '').split('\n')) {
    try {
      const metric = JSON.parse(line)
      if (metric.benchmark?.startsWith('large-transcript-')) metrics.push(metric)
    } catch { /* Human-readable smoke output is not a metric. */ }
  }
  const timingFailures = frameP95LimitMs === null ? [] : metrics.filter(metric =>
    !metric.frames?.count || !Number.isFinite(metric.frames.p95) || metric.frames.p95 > frameP95LimitMs)
  const passed = run.status === 0 && !timingFailures.length
  const result = { name, passed, exitCode: run.status, durationMs: Math.round(performance.now() - start), metrics }
  if (run.error) result.error = run.error.message
  results.push(result)
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name} (${result.durationMs}ms)`)
  for (const metric of metrics) console.log(JSON.stringify(metric))
  if (!passed) {
    console.error(output.slice(-12_000))
    if (run.error) console.error(run.error.message)
    if (timingFailures.length) console.error(`Renderer-loop p95 exceeded ${frameP95LimitMs}ms or had no valid samples.`)
  }
}
const expectedMetrics = ['large-transcript-diff', 'large-transcript-markdown']
const sampled = results.flatMap(result => result.metrics).map(metric => metric.benchmark)
const missingMetrics = expectedMetrics.filter(name => !sampled.includes(name))
const passed = results.every(result => result.passed) && !missingMetrics.length
const report = {
  schemaVersion: 1, revision: revision.stdout?.trim(), dirty: Boolean(dirty.stdout?.trim()),
  bunVersion: bun.stdout.trim(), frameP95LimitMs,
  timingScope: 'renderer loop, including initial mount and viewport changes; physical terminal paint is not measured',
  passed, missingMetrics, results,
}
if (args.length) writeFileSync(path.resolve(args[1]), JSON.stringify(report, null, 2) + '\n')
console.log(`${passed ? 'PASS' : 'FAIL'} OpenTUI architecture: ${results.filter(result => result.passed).length}/${results.length} checks`)
if (missingMetrics.length) console.error(`Missing renderer metrics: ${missingMetrics.join(', ')}`)
process.exitCode = passed ? 0 : 1
