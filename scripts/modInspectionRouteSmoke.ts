import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { EMPTY_MOD_APP } from '../lib/plugins/modApp'
const temp = mkdtempSync(path.join(tmpdir(), 'mod-inspection-route-'))
process.env.AGENT_VIEWER_INSPECTION_DIR = path.join(temp, 'inspection')
process.env.AGENT_VIEWER_PLUGINS_DIR = path.join(temp, 'mods')
process.env.AGENT_VIEWER_PLUGIN_SETTINGS = path.join(temp, 'settings.json')
mkdirSync(path.join(temp, 'mods', 'route-mod'), { recursive: true })
writeFileSync(path.join(temp, 'mods', 'route-mod', 'plugin.json'), JSON.stringify({ id: 'route-mod', appServices: ['data'], views: [{ id: 'board' }], widgets: [{ id: 'state' }] }))
writeFileSync(path.join(temp, 'mods', 'route-mod', 'server.mjs'), `export const views = { board: ({ app }) => ({ title: app.instanceId, blocks: [] }) }; export const widgets = { state: ({ app }) => ({ text: app.instanceId }) };`)
mkdirSync(path.join(temp, 'mods', 'refused'), { recursive: true })
writeFileSync(path.join(temp, 'mods', 'refused', 'plugin.json'), 'not json')
const app = { ...EMPTY_MOD_APP, instanceId: 'web-route', focused: false }
const request = (url: string, body?: unknown) => new NextRequest(`http://localhost${url}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)
try {
  const route = await import('../app/api/plugins/inspection/route')
  assert.equal((await route.POST(request('/api/plugins/inspection', { app: { instanceId: '../../escape' } }))).status, 400)
  assert.equal((await route.POST(request('/api/plugins/inspection', { app: { ...app, renderer: 'tui' } }))).status, 400)
  const response = await route.POST(request('/api/plugins/inspection', { revision: 2, app: { ...app, secret: 'excluded', transcript: ['excluded'] }, diagnostics: [{ pluginId: 'route-mod', contribution: 'component-render', message: 'fixture error', at: Date.now(), count: 1 }] }))
  assert.equal(response.status, 200)
  await route.POST(request('/api/plugins/inspection', { revision: 1, app: { ...app, selectedKey: 'older-selection' } }))
  const status = await (await route.GET(request('/api/plugins/inspection?instance=web-route'))).json()
  assert.equal(status.instances.length, 1)
  assert.equal(status.instances[0].app.focused, false)
  assert.equal(status.instances[0].app.selectedKey, null, 'out-of-order publications cannot replace newer state')
  assert.equal('secret' in status.instances[0].app, false)
  assert.equal(status.instances[0].mods[0].id, 'route-mod')
  assert.equal(status.instances[0].refused.length, 1)
  assert.equal(status.instances[0].diagnostics[0].message, 'fixture error')
  const views = await import('../app/api/plugins/local/views/route')
  const rendered = await (await views.POST(request('/api/plugins/local/views', { operation: 'render', plugin: 'route-mod', view: 'board', app }))).json()
  assert.equal(rendered.view.title, 'web-route')
  const widgets = await import('../app/api/plugins/local/route')
  const content = await (await widgets.POST(request('/api/plugins/local', { operation: 'widgets', app }))).json()
  assert.equal(content.widgets[0].lines[0], 'web-route')
  console.log('Mod inspection routes: PASS (instance validation, public context only, refusals/errors and per-request view/widget context)')
} finally { rmSync(temp, { recursive: true, force: true }) }
