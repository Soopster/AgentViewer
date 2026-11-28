// Editing a mod reloads it with no restart and no explicit reload: the watcher writes the same
// revision marker `mods reload` writes, discovery applies it, and the new server code runs.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const temp = mkdtempSync(path.join(tmpdir(), 'mod-auto-reload-'))
process.env.AGENT_VIEWER_PLUGINS_DIR = path.join(temp, 'plugins')
delete process.env.AGENT_VIEWER_MODS_WATCH
const { requestModReload, readModReloadRequest } = await import('../lib/plugins/modReload')
const { localPluginDiscovery, resetLocalPluginDiscovery } = await import('../lib/plugins/localPlugins')
const { runLocalPluginCommand } = await import('../lib/plugins/localPluginRuntime')
const { stopModWatcher, modTreeSignature } = await import('../lib/plugins/modWatch')

const dev = path.join(temp, 'dev-mod'); mkdirSync(dev)
const manifest = { id: 'auto-fixture', commands: [{ id: 'value' }] }
const source = (value: string) => `export const commands = { value: () => ({ notice: '${value}' }) }`
writeFileSync(path.join(dev, 'plugin.json'), JSON.stringify(manifest)); writeFileSync(path.join(dev, 'server.mjs'), source('first'))
const run = async () => (await runLocalPluginCommand({ pluginId: 'auto-fixture', commandId: 'value', target: { session: null, cwd: null } }, new AbortController().signal)).notice?.text
const until = async (label: string, test: () => boolean | Promise<boolean>, ms = 8_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await test()) return; await new Promise(resolve => setTimeout(resolve, 100)) } assert.fail(label) }

try {
  resetLocalPluginDiscovery()
  requestModReload([dev])
  assert.equal(localPluginDiscovery().plugins.length, 1)      // starts the watcher
  assert.equal(await run(), 'first')
  const revision = readModReloadRequest().revision

  // 1. Editing the server module reloads it, unprompted.
  await new Promise(resolve => setTimeout(resolve, 600))
  writeFileSync(path.join(dev, 'server.mjs'), source('second'))
  await until('a changed source file requests a reload', () => readModReloadRequest().revision !== revision)
  localPluginDiscovery()
  assert.equal(await run(), 'second', 'the new code runs without a restart')
  assert.deepEqual(readModReloadRequest().developmentDirs, [dev], 'the explicit development directory survives an automatic reload')

  // 2. A change to a manifest is picked up too (a new command appears).
  const afterCode = readModReloadRequest().revision
  await new Promise(resolve => setTimeout(resolve, 3_300))
  writeFileSync(path.join(dev, 'plugin.json'), JSON.stringify({ ...manifest, commands: [{ id: 'value' }, { id: 'extra' }] }))
  await until('a changed manifest requests a reload', () => readModReloadRequest().revision !== afterCode)
  assert.deepEqual(localPluginDiscovery().plugins[0]!.manifest.commands.map(command => command.id), ['auto-fixture:value', 'auto-fixture:extra'])

  // 3. Files that are not source (logs, caches) and dependencies do not reload anything.
  const settled = readModReloadRequest().revision
  await new Promise(resolve => setTimeout(resolve, 3_300))
  writeFileSync(path.join(dev, 'activity.log'), 'x'); mkdirSync(path.join(dev, 'node_modules', 'dep'), { recursive: true }); writeFileSync(path.join(dev, 'node_modules', 'dep', 'index.js'), 'x')
  await new Promise(resolve => setTimeout(resolve, 1_500))
  assert.equal(readModReloadRequest().revision, settled, 'non-source files and node_modules never reload')
  assert.equal(modTreeSignature(dev).includes('activity.log'), false); assert.equal(modTreeSignature(dev).includes('node_modules'), false)

  // 4. A burst of edits is one reload, not one per write.
  const before = readModReloadRequest().revision
  await new Promise(resolve => setTimeout(resolve, 3_300))
  for (let i = 0; i < 5; i++) { writeFileSync(path.join(dev, 'server.mjs'), source(`burst-${i}`)); await new Promise(resolve => setTimeout(resolve, 30)) }
  await until('the burst reloads', () => readModReloadRequest().revision !== before)
  const burst = readModReloadRequest().revision
  await new Promise(resolve => setTimeout(resolve, 1_200))
  assert.equal(readModReloadRequest().revision, burst, 'one reload for the burst')
  localPluginDiscovery(); assert.equal(await run(), 'burst-4')
  console.log('modAutoReloadSmoke: ok')
} finally { stopModWatcher() }
process.exit(0)
