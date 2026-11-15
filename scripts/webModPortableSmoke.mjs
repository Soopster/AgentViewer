import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { renderLocalPluginView, runLocalPluginViewAction } from '../lib/plugins/localPluginRuntime.ts'
const temp = await mkdtemp(path.join(tmpdir(), 'web-mod-portable-'))
process.env.AGENT_VIEWER_PLUGINS_DIR = path.join(temp, 'plugins')
const dir = path.join(process.env.AGENT_VIEWER_PLUGINS_DIR, 'portable'); await mkdir(dir, { recursive: true })
await writeFile(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'portable', title: 'Portable', config: { greeting: { type: 'string', title: 'Greeting', default: 'Hello' }, enabled: { type: 'boolean', title: 'Enabled', default: false }, retries: { type: 'number', title: 'Retries', default: 2, min: 0, max: 5 } }, views: [{ id: 'board', title: 'Board' }] }))
await writeFile(path.join(dir, 'server.mjs'), `export const views = {board: ({config}) => ({title:'Portable board',blocks:[{type:'input',id:'echo',label:'Echo',action:'echo',value:'initial'},{type:'select',id:'mode',label:'Mode',action:'mode',options:[{value:'fast',label:'Fast'},{value:'careful',label:'Careful'}]},{type:'progress',label:'Build',value:1,max:2},{type:'table',columns:['Job','Status'],rows:[['build','running']]},{type:'code',text:'npm run build'}]})}; export const actions = {echo: ({item}) => ({notice:'Echo:'+item}),mode: ({item})=>({notice:'Mode:'+item})}`)
let browser, server
try {
  await build({ entryPoints: ['scripts/webModPortableBrowserFixture.tsx'], bundle: true, platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'fixture.js'), logLevel: 'silent' })
  const script = await readFile(path.join(temp, 'fixture.js'))
  server = createServer(async (req, res) => {
    try {
      if (req.url === '/api/plugins/local/views') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const body = JSON.parse(Buffer.concat(chunks).toString())
        const result = body.operation === 'render' ? { view: await renderLocalPluginView(body.plugin, body.view) } : await runLocalPluginViewAction(body.plugin, body.view, body.action, body.item)
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result)); return
      }
      res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html')
      res.end(req.url === '/fixture.js' ? script : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>')
    } catch (error) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: error.message })) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(10000)
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByLabel('Echo', { exact: true }).fill('')
  await page.getByLabel('Echo', { exact: true }).press('Enter')
  await page.getByRole('status').filter({ hasText: 'Echo:' }).waitFor()
  await page.getByLabel('Mode', { exact: true }).selectOption('careful').catch(async error => { console.error(await page.locator('body').innerText()); console.error(errors); throw error })
  await page.getByLabel('Mode', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Apply' }).click()
  await page.getByRole('status').filter({ hasText: 'Mode:careful' }).waitFor()
  assert.equal(await page.getByRole('progressbar', { name: 'Build' }).getAttribute('value'), '1')
  assert.equal(await page.getByRole('cell', { name: 'running' }).count(), 1)
  await page.getByText('npm run build', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Switch view' }).click()
  await page.getByLabel('Greeting', { exact: true }).fill('Updated')
  await page.getByLabel('Greeting', { exact: true }).press('Enter')
  await page.getByRole('status').filter({ hasText: 'Greeting saved' }).waitFor()
  const configPath = path.join(temp, 'mod-settings', 'portable.json')
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).greeting, 'Updated')
  await page.getByLabel('Retries', { exact: true }).fill('99')
  await page.getByLabel('Retries', { exact: true }).press('Enter')
  await page.getByRole('status').filter({ hasText: 'Invalid config value' }).waitFor()
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).retries, undefined)
  await page.getByLabel('Enabled', { exact: true }).selectOption('true')
  await page.getByLabel('Enabled', { exact: true }).locator('..').locator('..').getByRole('button', { name: 'Apply' }).click()
  await page.getByRole('status').filter({ hasText: 'Enabled saved' }).waitFor()
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).enabled, true)
  assert.deepEqual(errors, [])
  console.log('Web portable mods: PASS (StrictMode, real HTTP/server actions, empty input, select, table/progress/code, generated settings save and invalid-value preservation)')
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }) }
