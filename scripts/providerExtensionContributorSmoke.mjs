import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, copyFile, symlink, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { scaffoldProviderExtension } from './scaffoldProviderExtension.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'av-provider-contributor-'))
function run(command, args) {
  const result = spawnSync(command, args, { cwd: temporary, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`)
}

try {
  // A source-only copy: never mutate the user's registration tables to test a
  // hypothetical contributor. Include current shared-worktree changes.
  const listing = spawnSync('rg', ['--files', '--hidden', '-g', '!node_modules', '-g', '!.git', '-g', '!.next', '-g', '!work', '-g', '!.agent-viewer-data'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  assert.equal(listing.status, 0)
  const sources = listing.stdout.trim().split('\n').filter(name => /\.(?:[cm]?ts|tsx|[cm]?js|json)$/.test(name))
  await Promise.all(sources.map(async name => {
    const destination = path.join(temporary, name)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.join(root, name), destination)
  }))
  await symlink(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'dir')
  const nextEnv = await readFile(path.join(temporary, 'next-env.d.ts'), 'utf8')
  await writeFile(path.join(temporary, 'next-env.d.ts'), nextEnv.replace(/^import .*\.next.*\n/gm, ''))
  await scaffoldProviderExtension(temporary, 'contributor-fixture', 'Contributor Fixture')
  await assert.rejects(scaffoldProviderExtension(temporary, 'contributor-fixture', 'Duplicate'), /already exists/)
  await assert.rejects(scaffoldProviderExtension(temporary, '../escape', 'Invalid'), /unique lowercase/)
  const fixture = path.join(temporary, 'lib/extensions/providers/contributor-fixture')
  const manifestPath = path.join(fixture, 'manifest.ts')
  await writeFile(manifestPath, (await readFile(manifestPath, 'utf8')).replace('supportsInstances: false', 'supportsInstances: true'))
  for (const name of ['adapter', 'runtime', 'workflow']) {
    const source = await readFile(path.join(root, `scripts/fixtures/provider-extension/${name}.ts.fixture`), 'utf8')
    await writeFile(name === 'workflow' ? path.join(temporary, 'provider-fixture-workflow.ts') : path.join(fixture, `${name}.ts`), source)
  }
  await mkdir(path.join(temporary, '.agent-viewer-data'))
  await writeFile(path.join(temporary, '.agent-viewer-data/provider-instances.json'), JSON.stringify({ version: 1, instances: [
    { id: 'fixture-a', provider: 'contributor-fixture', displayName: 'A' },
    { id: 'fixture-b', provider: 'contributor-fixture', displayName: 'B' },
  ] }))
  run(process.execPath, [path.join(root, 'node_modules/typescript/lib/tsc.js'), '--noEmit', '--incremental', 'false'])
  run(process.execPath, [path.join(root, 'node_modules/typescript/lib/tsc.js'), '--noEmit', '--incremental', 'false', '-p', 'tsconfig.opentui.json'])
  run('bun', ['run', 'provider-fixture-workflow.ts'])
  console.log('provider contributor smoke: PASS (scaffold plus registration only; both application typechecks)')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
