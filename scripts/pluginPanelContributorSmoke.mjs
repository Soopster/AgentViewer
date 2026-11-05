import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, copyFile, symlink, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'av-plugin-panel-contributor-'))
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
  // Only a manifest, its views, and the two loader entries are added.
  const pluginDir = path.join(temporary, 'plugins/fixture-panel')
  await mkdir(pluginDir, { recursive: true })
  const manifest = (await readFile(path.join(root, 'plugins/files/manifest.ts'), 'utf8')).replaceAll("'files'", "'fixture-panel'")
  await writeFile(path.join(pluginDir, 'manifest.ts'), manifest)
  for (const renderer of ['web', 'tui']) {
    await mkdir(path.join(pluginDir, renderer))
    await writeFile(path.join(pluginDir, renderer, 'index.ts'), "export const module = { apiVersion: 1 as const, pluginId: 'fixture-panel', views: { 'fixture-panel': () => null } }\n")
    const loaderPath = path.join(temporary, renderer === 'web' ? 'components/shell/pluginViews.ts' : 'tui/opentui/shell/pluginViews.ts')
    const specifier = renderer === 'web' ? '@/plugins/fixture-panel/web' : '../../../plugins/fixture-panel/tui'
    const loader = await readFile(loaderPath, 'utf8')
    await writeFile(loaderPath, loader.replace("  analytics: async", `  'fixture-panel': async () => (await import('${specifier}')).module,\n  analytics: async`))
  }
  const catalogPath = path.join(temporary, 'lib/plugins/catalog.ts')
  const catalog = await readFile(catalogPath, 'utf8')
  await writeFile(catalogPath, "import { manifest as fixturePanel } from '../../plugins/fixture-panel/manifest'\n" + catalog.replace('PLUGIN_MANIFESTS = [', 'PLUGIN_MANIFESTS = [fixturePanel, '))
  run(process.execPath, [path.join(root, 'node_modules/typescript/lib/tsc.js'), '--noEmit', '--incremental', 'false'])
  run(process.execPath, [path.join(root, 'node_modules/typescript/lib/tsc.js'), '--noEmit', '--incremental', 'false', '-p', 'tsconfig.opentui.json'])
  console.log('plugin panel contributor smoke: PASS (manifest and loaders only; both application typechecks)')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
