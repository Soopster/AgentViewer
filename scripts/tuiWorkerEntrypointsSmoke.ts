// Every TUI worker the code starts must exist, and must be an entrypoint of the
// compiled desktop binary — a worker missing from that list works from source
// and fails only in the shipped app. Also pins how workerUrl.ts maps a worker's
// repository path in both layouts.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tuiWorkerUrl } from '../tui/opentui/workerUrl'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name)
  return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) && !/Smoke|Perf/.test(name) ? [full] : []
})
const started = new Set<string>()
for (const file of [...walk(path.join(root, 'tui')), ...walk(path.join(root, 'plugins'))]) {
  for (const match of readFileSync(file, 'utf8').matchAll(/tuiWorkerUrl\(\s*'([^']+)'/g)) started.add(match[1]!)
}
assert.ok(started.size >= 6, `found only ${started.size} workers`)
const build = readFileSync(path.join(root, 'scripts/prepareDesktopResources.mjs'), 'utf8')
for (const worker of started) {
  assert.ok(existsSync(path.join(root, `${worker}.ts`)), `${worker}.ts does not exist`)
  assert.ok(build.includes(`'${worker}.ts'`), `${worker}.ts is not a desktop build entrypoint`)
}
assert.match(build, /'--root',\s*'\.'/, 'the desktop build no longer pins --root .')

assert.equal(tuiWorkerUrl('plugins/a/tui/w', 'file:///$bunfs/root/agent-viewer-tui'), 'file:///$bunfs/root/plugins/a/tui/w.js')
assert.equal(tuiWorkerUrl('tui/opentui/w', 'file:///B:/~BUN/root/agent-viewer-tui.exe'), 'file:///B:/~BUN/root/tui/opentui/w.js')
assert.equal(tuiWorkerUrl('tui/opentui/w', 'file:///repo/tui/opentui/workerUrl.ts'), 'file:///repo/tui/opentui/w.ts')
console.log(`tui worker entrypoints: PASS (${started.size} workers)`)
