import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const providers = {
  claude: ['@anthropic-ai/claude-agent-sdk'], codex: [],
  opencode: ['@opencode-ai/sdk'], copilot: ['@github/copilot-sdk'],
  pi: ['@earendil-works/pi-coding-agent'],
  acp: ['@agentclientprotocol/sdk'], 'claude-acp': ['@agentclientprotocol/sdk'], 'codex-acp': ['@agentclientprotocol/sdk'],
  lmstudio: [],
}
const packages = [...new Set(Object.values(providers).flat())]
for (const [provider, allowed] of Object.entries(providers)) {
  // A fresh isolate is essential: another provider's preceding import must
  // never hide an eager SDK dependency in this provider's module graph.
  const script = `
    import assert from 'node:assert/strict'
    const packages = ${JSON.stringify(packages)}
    const loaded = () => packages.filter(pkg => Object.keys(require.cache).some(file => file.includes('/node_modules/' + pkg + '/')))
    await import('./lib/sessionBackend')
    assert.deepEqual(loaded(), [], 'the core facade must load no provider SDK')
    const { getProviderRuntime } = await import('./lib/extensions/providers/registry')
    const runtime = await getProviderRuntime(${JSON.stringify(provider)})
    assert.equal(typeof runtime.createSession, 'function')
    assert.equal(typeof runtime.streamTurn, 'function')
    for (const pkg of loaded()) assert.ok(${JSON.stringify(allowed)}.includes(pkg), 'unexpected SDK in ${provider}: ' + pkg)
    console.log(JSON.stringify({ provider: ${JSON.stringify(provider)}, loadedSdkPackages: loaded() }))
    process.exit(0)
  `
  const result = spawnSync('bun', ['-e', script], { cwd: root, env: { ...process.env, AGENT_VIEWER_PLUGIN_SETTINGS: path.join(root, 'node_modules', '.no-plugin-settings.json') }, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${provider} runtime boundary failed`)
}
console.log('Provider runtime SDK boundaries passed in nine cold isolates')
