import { pluginBehaviorHost } from '../lib/plugins/serverBehaviors'
import { publishPluginRuntimeEvent } from '../lib/plugins/runtimeEvents'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { requestModReload } from '../lib/plugins/modReload'
import { localPluginDiscovery, resetLocalPluginDiscovery } from '../lib/plugins/localPlugins'
import { runLocalPluginCommand, runLocalPluginViewAction } from '../lib/plugins/localPluginRuntime'
import { NextRequest } from 'next/server'
import { POST as inspect } from '../app/api/plugins/inspection/route'
import { EMPTY_MOD_APP } from '../lib/plugins/modApp'
const temp = mkdtempSync(path.join(tmpdir(), 'mod-reload-'))
const previousInspection = process.env.AGENT_VIEWER_INSPECTION_DIR
process.env.AGENT_VIEWER_INSPECTION_DIR = path.join(temp, 'inspection')
const previous = process.env.AGENT_VIEWER_PLUGINS_DIR
process.env.AGENT_VIEWER_PLUGINS_DIR = path.join(temp, 'plugins')
const dev = path.join(temp, 'explicit-dev'); mkdirSync(dev)
const globals = globalThis as unknown as { reloadDeactivated?: number; releaseReload?: () => void; reloadEvents?: string[] }
const manifest = { id: 'reload-fixture', behavior: { hooks: ['runtimeEvent'] }, commands: [{ id: 'value' }], views: [{ id: 'board', title: 'Board' }] }
const source = (value: string) => `export function runtimeEvent(){(globalThis.reloadEvents ||= []).push('${value}')};export const commands = {value:()=>({notice:'${value}'})};export const views={board:()=>({title:'${value}',blocks:[]})};export const actions={wait:async()=>{await new Promise(resolve=>{globalThis.releaseReload=resolve});return {notice:'late'}}};export function deactivate(){globalThis.reloadDeactivated=(globalThis.reloadDeactivated||0)+1}`
writeFileSync(path.join(dev, 'plugin.json'), JSON.stringify(manifest)); writeFileSync(path.join(dev, 'server.mjs'), source('first'))
const run = () => runLocalPluginCommand({ pluginId: manifest.id, commandId: 'value', target: { session: null, cwd: null } }, new AbortController().signal)
try {
  resetLocalPluginDiscovery()
  assert.equal(localPluginDiscovery().plugins.length, 0, 'project/dev source never auto-discovers')
  const initial = requestModReload([dev]); assert.equal(localPluginDiscovery().revision, initial.revision)
  pluginBehaviorHost()
  assert.equal((await run()).notice?.text, 'first')
  publishPluginRuntimeEvent({type:'turn.started',source:'runtime-registry',target:{provider:'claude',sessionId:'fixture'}})
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(globals.reloadEvents, ['first'])
  const pending = runLocalPluginViewAction(manifest.id, 'board', 'wait', undefined)
  while (!globals.releaseReload) await Promise.resolve()
  writeFileSync(path.join(dev, 'server.mjs'), source('second'))
  const next = requestModReload()
  assert.notEqual(next.revision, initial.revision)
  localPluginDiscovery()
  globals.releaseReload()
  await assert.rejects(pending, /reloaded/)
  assert.equal((await run()).notice?.text, 'second')
  publishPluginRuntimeEvent({type:'turn.settled',source:'runtime-registry',target:{provider:'claude',sessionId:'fixture'}})
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(globals.reloadEvents, ['first','second'], 'reload re-arms observers for an existing turn')
  assert.equal(globals.reloadDeactivated, 1, 'one deactivation per old module')
  const response = await inspect(new NextRequest('http://localhost/api/plugins/inspection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: { ...EMPTY_MOD_APP, instanceId: 'web-reload-fixture' }, modRevision: initial.revision }) }))
  const report = await response.json(); assert.equal(report.local.revision, next.revision)
  assert.equal(report.local.plugins[0].id, manifest.id)
  const unchanged = await inspect(new NextRequest('http://localhost/api/plugins/inspection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: { ...EMPTY_MOD_APP, instanceId: 'web-reload-fixture' }, modRevision: next.revision }) }))
  assert.equal((await unchanged.json()).local, undefined, 'unchanged heartbeats do not churn registries')
  requestModReload([]); assert.equal(localPluginDiscovery().plugins.length, 0)
  await assert.rejects(run(), /No local plugin/)
  console.log('Mod reload: PASS (explicit dev directory, fresh entry code, single deactivation, stale effect refusal, Web heartbeat revisions, re-armed runtime observers, clear dev)')
} finally {
  if (previous === undefined) delete process.env.AGENT_VIEWER_PLUGINS_DIR; else process.env.AGENT_VIEWER_PLUGINS_DIR = previous
  if (previousInspection === undefined) delete process.env.AGENT_VIEWER_INSPECTION_DIR; else process.env.AGENT_VIEWER_INSPECTION_DIR = previousInspection
  resetLocalPluginDiscovery(); rmSync(temp, { recursive: true, force: true }); delete globals.reloadEvents; delete globals.reloadDeactivated; delete globals.releaseReload
}
