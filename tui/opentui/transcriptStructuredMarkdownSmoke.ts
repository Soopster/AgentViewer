import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

for (const kind of ['code', 'list', 'table']) {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./transcriptLargeMarkdownSmoke.tsx', import.meta.url))], {
    env: { ...process.env, STRUCTURED_MARKDOWN_KIND: kind, STRUCTURED_MARKDOWN_PERF: '0' },
    encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  })
  if (run.status !== 0) {
    process.stderr.write(run.stdout + run.stderr)
    if (run.error) console.error(run.error)
    process.exit(run.status ?? 1)
  }
  for (const line of run.stdout.split('\n')) if (line.startsWith('{')) console.log(line)
}
console.log('Structured Markdown passed: giant fences, lists and tables; bounded top/middle/tail mounts and complete source extent')
