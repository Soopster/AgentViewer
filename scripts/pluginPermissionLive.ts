// The permission hook against REAL agents (spends a little model usage). Each
// provider is asked to run a probe command; a mod's permission hook denies it.
// A provider passes when the hook was consulted for its approval and the
// agent's command never ran. A provider whose mode runs the command without
// asking reports "never asked" — the hook has nothing to answer there.
// Usage: bun scripts/pluginPermissionLive.ts [codex,opencode,copilot,claude]
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const providers = (process.argv[2] && process.argv[2] !== 'child' ? process.argv[2] : process.env.PERMISSION_LIVE_PROVIDERS ?? 'codex,opencode,copilot,claude').split(',')
if (process.argv[2] !== 'child') {
  const results: string[] = []
  for (const provider of providers) {
    const dir = mkdtempSync(path.join(tmpdir(), `perm-live-${provider}-`))
    spawnSync('git', ['init', '-q'], { cwd: dir })
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child', provider, dir], { encoding: 'utf8', timeout: 240_000, env: process.env })
    const line = (child.stdout ?? '').split('\n').find(entry => entry.startsWith('RESULT ')) ?? `RESULT ${provider}: FAIL (exit ${child.status}) ${(child.stderr ?? '').split('\n').filter(Boolean).slice(-3).join(' | ')}`
    results.push(line.slice('RESULT '.length))
  }
  console.log(results.join('\n'))
  process.exit(results.some(line => line.includes('FAIL') || line.includes('inconclusive')) ? 1 : 0)
} else {
  const provider = process.argv[3] as 'codex' | 'opencode' | 'copilot' | 'claude'
  const dir = process.argv[4]!
  process.chdir(dir)
  const log = path.join(dir, 'asked.jsonl')
  const mods = path.join(dir, 'mods')
  mkdirSync(path.join(mods, 'guard'), { recursive: true })
  writeFileSync(path.join(mods, 'guard', 'plugin.json'), JSON.stringify({ id: 'guard', title: 'Guard', behavior: { hooks: ['permission'] } }))
  writeFileSync(path.join(mods, 'guard', 'server.mjs'), `import { appendFileSync } from 'node:fs'
export function permission({ request, target }) {
  appendFileSync(${JSON.stringify(log)}, JSON.stringify({ provider: target.provider, kind: request.kind, toolName: request.toolName, command: request.command }) + '\\n')
  if (JSON.stringify(request).includes('perm-probe')) return { decision: 'deny', reason: 'guard plugin: the probe is not allowed' }
}`)
  process.env.AGENT_VIEWER_PLUGINS_DIR = mods
  process.env.AGENT_VIEWER_PLUGIN_SETTINGS = path.join(dir, 'plugin-settings.json')
  const probe = path.join(dir, 'perm-probe.txt')
  // Make each agent ask for this command, as a user's own project config would.
  if (provider === 'opencode') writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({ $schema: 'https://opencode.ai/config.json', permission: { bash: 'ask' } }))
  if (provider === 'claude') { mkdirSync(path.join(dir, '.claude'), { recursive: true }); writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { ask: ['Bash(touch:*)'] } })) }
  try {
    const backend = await import('../lib/sessionBackend')
    const created = await backend.createNewViewSession({ provider, cwd: dir })
    // OpenCode's default model may not be usable on this account: take the
    // configured one (PERMISSION_LIVE_OPENCODE_MODEL) or the first it offers.
    let model: string | undefined = provider === 'opencode' ? process.env.PERMISSION_LIVE_OPENCODE_MODEL : undefined
    if (provider === 'opencode' && !model) {
      const { readViewSessionModels } = await import('../lib/sessionReads')
      const models = await readViewSessionModels(created.sessionId, 'opencode').catch(() => null)
      model = models?.models?.find(entry => /free|mini|flash|haiku|small/i.test(entry.value))?.value ?? models?.models?.[0]?.value
    }
    const body: Record<string, unknown> = {
      ...(model ? { model } : {}),
      // A new Claude session has no conversation until its first turn.
      ...(created.isPending ? { isPendingSession: true } : {}),
      message: `Use your shell tool to run exactly this command: touch perm-probe.txt — then reply with one line saying whether it ran. Do not try any other way to create the file.`,
      cwd: dir,
      // Ask before acting where the provider has a mode for it.
      // Claude installs its approval bridge only when the composer asks for approvals.
      ...(provider === 'claude' ? { permissionMode: 'default', manualPermissions: true } : {}),
      ...(provider === 'codex' ? { approvalPolicy: 'untrusted' } : {}),
    }
    const response = await backend.streamViewSessionTurn({ provider, sessionId: created.sessionId, body, signal: AbortSignal.timeout(200_000) })
    const text = await new Response(response.body).text()
    const asked = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
    const ran = existsSync(probe)
    const probeAsked = asked.filter(entry => JSON.stringify(entry).includes('perm-probe'))
    if (probeAsked.length && !ran) console.log(`RESULT ${provider}: PASS (hook consulted ${probeAsked.length}× as ${probeAsked[0].kind}; command denied, never ran)`)
    else if (probeAsked.length && ran) console.log(`RESULT ${provider}: FAIL (hook denied but the command ran)`)
    else if (!asked.length && ran) console.log(`RESULT ${provider}: never asked (its mode ran the command without an approval; tools ${[...new Set([...text.matchAll(/"name":"([A-Za-z_]+)"/g)].map(m => m[1]))].join(',')}; mode ${JSON.stringify(text.match(/"permissionMode":"[a-zA-Z]+"/)?.[0] ?? '')})`)
    else console.log(`RESULT ${provider}: inconclusive (asked ${JSON.stringify(asked)}, ran ${ran}) ${text.slice(-200).replace(/\n/g, ' ')}`)
  } catch (error) {
    console.log(`RESULT ${provider}: FAIL ${error instanceof Error ? error.message : String(error)}`)
  }
  process.exit(0)
}
