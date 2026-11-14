#!/usr/bin/env node
import { readAppInspections } from '../lib/plugins/appInspection.mjs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const args = process.argv.slice(2)
const [mode, verb, ...rest] = args
const usage = 'Usage: agent-viewer mods check <path> [--render] [--json] | mods status [--instance <id>] [--json] | app status [--instance <id>] [--json]'
if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0) }
if (mode === 'mods' && verb === 'check') {
  const child = spawn(process.env.AGENT_VIEWER_BUN || 'bun', ['run', fileURLToPath(new URL('./agent-viewer-mod-check.ts', import.meta.url)), ...rest], { stdio: 'inherit' })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
} else if ((mode === 'app' || mode === 'mods') && verb === 'status') {
  const instanceAt = rest.indexOf('--instance')
  const instance = instanceAt < 0 ? undefined : rest[instanceAt + 1]
  if (instanceAt >= 0 && (!instance || instance.startsWith('--'))) { console.error(usage); process.exit(2) }
  const unknown = rest.filter((arg, index) => arg !== '--json' && arg !== '--instance' && !(instanceAt >= 0 && index === instanceAt + 1))
  if (unknown.length) { console.error(usage); process.exit(2) }
  const instances = readAppInspections(instance).map(entry => mode === 'app' ? entry : {
    instanceId: entry.app.instanceId, renderer: entry.app.renderer, pid: entry.pid, updatedAt: entry.updatedAt, stale: entry.stale,
    mods: entry.mods.map(mod => ({ ...mod, status: !mod.enabled ? 'disabled' : entry.diagnostics.some(error => error.pluginId === mod.id) ? 'failed' : 'enabled', errors: entry.diagnostics.filter(error => error.pluginId === mod.id) })), refused: entry.refused ?? [],
  })
  if (rest.includes('--json')) console.log(JSON.stringify({ version: 1, instances }, null, 2))
  else if (!instances.length) console.log('No matching app instances. Start Web or OpenTUI to publish inspection data.')
  else for (const entry of instances) {
    const id = entry.app?.instanceId ?? entry.instanceId
    console.log(`${id} · ${entry.app?.renderer ?? entry.renderer} · pid ${entry.pid} · ${entry.stale ? 'stale / disconnected' : 'live'} · ${new Date(entry.updatedAt).toISOString()}`)
    if (entry.app) console.log(`  ${entry.app.cwd ?? 'no repository'} · selected ${entry.app.selectedKey ?? 'none'} · focus ${entry.app.focused === null ? 'unknown' : entry.app.focused} · surface ${entry.app.focusedSurface ?? 'none'}`)
    for (const mod of entry.mods) console.log(`  ${mod.id}: ${mod.status ?? (mod.enabled ? 'enabled' : 'disabled')}${mod.errors?.length ? ` (${mod.errors.length} errors)` : ''}`)
    for (const refused of entry.refused ?? []) console.log(`  ${refused.id ?? refused.dir}: refused · ${refused.problems.join('; ')}`)
  }
  if (instance && !instances.length) process.exitCode = 1
} else { console.error(usage); process.exitCode = 2 }
