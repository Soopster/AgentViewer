import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { parseLocalPluginManifest } from '../lib/plugins/localManifest.ts'
const temp = await mkdtemp(path.join(tmpdir(), 'web-mod-reload-'))
let server, browser, revision = 1, release
const revisionsSeen = [], componentLoads = []
const payload = () => ({ local: { revision: `r${revision}`, plugins: [parseLocalPluginManifest({ id: 'reload-ui', version: `${revision}.0.0`, appServices: ['navigation'], views: [{ id: 'board', title: 'Board', ...(revision === 2 ? { placements: ['panel', 'window'], defaultPlacement: 'panel' } : {}) }, { id: 'meter', title: 'Meter', component: true }], commands: [{ id: revision === 1 ? 'old' : 'new', label: revision === 1 ? 'Old action' : 'New action' }] }, new Set()).manifest] } })
try {
  await build({ entryPoints: ['scripts/webModReloadFixture.tsx'], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'fixture.js'), logLevel: 'silent' })
  const script = await readFile(path.join(temp, 'fixture.js'))
  server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
      const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) }
      if (req.url === '/advance') { revision = 2; return json({ ok: true }) }
      if (req.url === '/release') { release?.(); return json({ ok: true }) }
      if (req.url === '/api/plugins/inspection') { revisionsSeen.push(body.modRevision); return json(body.modRevision === `r${revision}` ? { diagnostics: [] } : { ...payload(), diagnostics: [] }) }
      if (req.url?.startsWith('/api/plugins/local/component?')) {
        const version = revision; componentLoads.push(version)
        res.setHeader('content-type', 'text/javascript'); res.end(`export function views({React}) { function Meter(){ const [count,setCount]=React.useState(0); return React.createElement('div',null,React.createElement('span',null,'Meter v${version} count '+count),React.createElement('button',{onClick:()=>setCount(n=>n+1)},'Increment')) }; return {meter:Meter} }`); return
      }
      if (req.url === '/api/plugins/local/views') {
        if (body.operation === 'render') return json({ view: { title: `Board v${revision}`, blocks: [{ type: 'button', label: 'Pending old action', action: 'late' }] } })
        if (body.action === 'late') { await new Promise(resolve => { release = resolve }); return json({ appEffects: [{ type: 'command', id: 'git' }] }) }
      }
      res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/fixture.js' ? script : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>')
    } catch (error) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: error.message })) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(10000)
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByText('Board v1', { exact: true }).waitFor()
  await page.getByText('Meter v1 count 0', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Increment', exact: true }).click()
  await page.getByText('Meter v1 count 1', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Pending old action', exact: true }).click()
  for (let i = 0; i < 100 && !release; i++) await page.waitForTimeout(10)
  assert(release, 'old action must be pending across reload')
  await page.getByRole('button', { name: 'Advance revision', exact: true }).click()
  await page.getByText('Board v2', { exact: true }).waitFor()
  await page.getByText('Meter v2 count 0', { exact: true }).waitFor()
  await page.getByLabel('Catalog state').filter({ hasText: 'New action:panel:panel,window:old-removed' }).waitFor()
  await page.getByRole('button', { name: 'Release old action', exact: true }).click()
  await page.waitForTimeout(100)
  assert.equal(await page.getByLabel('Navigation effects').textContent(), '', 'old action effects must be suppressed after catalog reload')
  assert(revisionsSeen.includes('r1') && revisionsSeen.includes('r2'), 'inspection handshake must carry the current manifest revision')
  assert(componentLoads.includes(1) && componentLoads.includes(2), 'component module must reload across catalog change')
  assert.deepEqual(errors, [])
  console.log('Web mod reload: PASS (inspection revision handshake, catalog command/panel replacement, existing data refresh, custom component reload/remount, pending old action effects suppressed)')
} finally { release?.(); await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }) }
