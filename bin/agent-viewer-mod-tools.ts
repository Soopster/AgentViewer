import { PLUGIN_API_VERSION } from '../lib/plugins/types'
import { requestModReload } from '../lib/plugins/modReload'
// Author tools run only on explicit CLI invocation; discovery never imports code.
import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { PLUGIN_MANIFESTS } from '../lib/plugins/catalog'
import { randomUUID } from 'node:crypto'
import { localPluginDiscovery } from '../lib/plugins/localPlugins'
import { readModConfigValues, writeModConfig } from '../lib/plugins/modConfigStore'
import { parseLocalPluginManifest, LOCAL_PLUGIN_ID } from '../lib/plugins/localManifest'
import { createModHarness, loadModTestModule } from '../lib/plugins/modTesting'

const [verb, name, ...args] = process.argv.slice(2)
try {
  if (verb === 'create') {
    if (!name || !LOCAL_PLUGIN_ID.test(name) || (args.length && (args.length !== 2 || args[0] !== '--path'))) throw new Error('Usage: agent-viewer mods create <id> [--path <new-directory>]')
    if (PLUGIN_MANIFESTS.some(manifest => manifest.id === name)) throw new Error('That id belongs to a bundled plugin')
    const dir = path.resolve(args[1] ?? name)
    // Never overwrite an existing directory, including an installed mod.
    mkdirSync(dir)
    try {
      writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id: name, version: '0.1.0', hostApi: { min: PLUGIN_API_VERSION, max: PLUGIN_API_VERSION }, title: name, description: 'A portable Agent Viewer mod', config: { greeting: { type: 'string', title: 'Greeting', default: 'Hello' } }, views: [{ id: 'main', title: name }], commands: [{ id: 'hello', label: 'Say hello', services: ['notices'] }] }, null, 2) + '\n')
      writeFileSync(path.join(dir, 'server.mjs'), `/** @type {import('agent-viewer/lib/plugins/modSdk.ts').ModServerModule} */
export default {
  commands: { hello: ({ config }) => ({ notice: { kind: 'info', text: String(config.greeting) } }) },
  views: { main: ({ config }) => ({ title: String(config.greeting), blocks: [
    { type: 'input', id: 'echo', label: 'Message', action: 'echo', placeholder: 'Type a message' },
    { type: 'progress', label: 'Ready', value: 1, max: 1 },
  ] }) },
  actions: { echo: ({ item }) => ({ notice: { kind: 'info', text: item || 'Hello' } }) },
}
`)
      writeFileSync(path.join(dir, 'main.test.mjs'), `import assert from 'node:assert/strict'
export default async function test(harness) {
  assert.equal((await harness.command('hello')).notice.text, 'Hello')
  assert.equal((await harness.press('main', 'echo', 'Works')).notice.text, 'Works')
  assert.equal(harness.sent.length, 0)
}
`)
      writeFileSync(path.join(dir, 'README.md'), `# ${name}

Check: agent-viewer mods check . --render --json
Test: agent-viewer mods test .

The test command executes trusted mod/test code. Fixtures never send provider turns.
Install this directory under ~/.config/agent-viewer/plugins/${name} and run agent-viewer mods reload (or restart).
Open ${name} or ${name} settings from the palette in Web or OpenTUI.
Configuration is validated and injected as context.config on the server.
Use secretEnv references for credentials; never put secrets in plugin.json.
See the installed agent-viewer-plugins skill, references/mod-sdk.md, for the API.
`)
      console.log(JSON.stringify({ ok: true, path: dir, pluginId: name }))
    } catch (error) { rmSync(dir, { recursive: true, force: true }); throw error }
  } else if (verb === 'reload') {
    const rest = [name, ...args].filter((arg): arg is string => arg !== undefined)
    let developmentDirs: string[] | undefined
    if (rest[0] === '--clear-dev' && rest.length === 1) developmentDirs = []
    else if (rest.length) {
      if (rest.length !== 2 || rest[0] !== '--dir') throw new Error('Usage: agent-viewer mods reload [--dir <trusted-mod-directory> | --clear-dev]')
      const dir = path.resolve(rest[1]!)
      const raw = JSON.parse(readFileSync(path.join(dir, 'plugin.json'), 'utf8'))
      const parsed = parseLocalPluginManifest(raw, new Set(PLUGIN_MANIFESTS.map(manifest => manifest.id)))
      if (!parsed.manifest) throw new Error(parsed.problems.join('; '))
      if (!['server.mjs', 'server.js', 'server.ts'].some(file => existsSync(path.join(dir, file)))) throw new Error('Missing server module')
      developmentDirs = [dir]
    }
    console.log(JSON.stringify({ ok: true, ...requestModReload(developmentDirs), message: 'Live instances apply this revision on their next heartbeat (normally within five seconds).' }))
  } else if (verb === 'configure') {
    if (!name || args.some(arg => arg !== '--values-stdin') || args.length > 1) throw new Error('Usage: agent-viewer mods configure <id> [--values-stdin]')
    const plugin = localPluginDiscovery().plugins.find(plugin => plugin.manifest.id === name)
    if (!plugin) throw new Error('Unknown installed mod')
    if (args.includes('--values-stdin')) {
      const input = readFileSync(0, 'utf8')
      if (input.length > 100000) throw new Error('Configuration input is too large')
      writeModConfig(name, plugin.manifest.config ?? {}, JSON.parse(input))
    }
    const values = readModConfigValues(name)
    console.log(JSON.stringify({ pluginId: name, schema: plugin.manifest.config ?? {}, configured: Object.keys(values) }))
  } else if (verb === 'test') {
    if (!name || (args.length && (args.length !== 2 || args[0] !== '--test-child'))) throw new Error('Usage: agent-viewer mods test <path>')
    const dir = path.resolve(name)
    const parsed = parseLocalPluginManifest(JSON.parse(readFileSync(path.join(dir, 'plugin.json'), 'utf8')), new Set())
    if (!parsed.manifest) throw new Error(parsed.problems.join('; '))
    const files = readdirSync(dir).filter(name => /\.test\.(mjs|js|ts)$/.test(name)).sort()
    if (!files.length) throw new Error('No *.test.mjs, *.test.js or *.test.ts files found')
    const entry = ['server.mjs', 'server.js', 'server.ts'].find(file => readdirSync(dir).includes(file))
    if (!entry) throw new Error('Missing server module')
    if (args[0] === '--test-child' && !files.includes(args[1]!)) throw new Error('Unknown test file')
    for (const file of files) {
      if (args[0] !== '--test-child') {
        const child = spawnSync(process.execPath, ['run', fileURLToPath(import.meta.url), 'test', dir, '--test-child', file], { encoding: 'utf8', timeout: 10000, maxBuffer: 1000000 })
        if (child.stdout) process.stdout.write(child.stdout)
        if (child.status !== 0 || child.error) throw new Error(`${file}: ${child.error?.message ?? child.stderr.trim() ?? 'failed'}`)
        continue
      }
      if (file !== args[1]) continue
      const module = await loadModTestModule(path.join(dir, entry))
      const test = await import(`${pathToFileURL(path.join(dir, file)).href}?test=${randomUUID()}`)
      if (typeof test.default !== 'function') throw new Error(`${file} must default-export an async test(harness) function`)
      const harness = createModHarness(module, { ...test.fixture, configSchema: parsed.manifest.config })
      try {
        await test.default(harness)
        console.log(`PASS ${file}`)
      } finally { harness.disable() }
    }
  } else throw new Error('Expected create, configure, reload or test')
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
