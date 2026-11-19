import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-playbook-plugin-'))
let browser, server
let releasePending
const historyReads = []
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webPlaybookPluginBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent', loader: { '.wasm': 'file' },
    define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' },
  })
  const script = await readFile(bundle)
  const css = (await readFile('app/globals.css', 'utf8')).replace(/^@import[^;]+;/gm, '').replace(/@font-face\s*\{[^}]*\}/g, '')
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : `<!doctype html><html data-theme="dark"><style>${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } })
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const commandWrites = []
  await page.route('**/api/**', route => {
    const request = route.request()
    if (new URL(request.url()).pathname.endsWith('/playbooks')) {
      if (request.method() === 'PUT') {
        const body = request.postDataJSON(); commandWrites.push(body)
        return route.fulfill({ json: { playbook: body.playbook, path: `${body.cwd}/${body.playbook.name}.json` } })
      }
      return route.fulfill({ json: { playbooks: [], invalid: [] } })
    }
    return route.fulfill({ json: { runs: [], tasks: [], events: [], models: [] } })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' })
  const click = name => page.getByRole('button', { name, exact: true }).click()
  const control = values => page.evaluate(values => Object.assign(window.__playbookControls, values), values)
  const pendingCount = count => page.waitForFunction(count => window.__playbookPending.length === count, count)
  const release = index => page.evaluate(index => window.__playbookPending[index].resolve(), index)
  await page.getByText('Seed workflow', { exact: true }).waitFor()
  await click('New')
  await page.getByLabel('Name', { exact: true }).fill('created')
  await click('Move placement')
  await page.getByLabel('Name', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'created', 'draft survives actual placement remount')
  await click('Save playbook')
  await page.getByRole('status').filter({ hasText: 'Saved playbook created' }).waitFor()
  await click('Edit')
  await page.getByLabel('Name', { exact: true }).fill('renamed')
  await control({ failWrite: true })
  await click('Save playbook')
  await page.getByRole('alert').filter({ hasText: 'Fixture save refused' }).waitFor()
  assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'renamed')
  await control({ failWrite: false })
  await click('Save playbook')
  await page.getByRole('status').filter({ hasText: 'Saved playbook renamed' }).waitFor()
  await click('Delete playbook')
  await click('Delete')
  await page.getByRole('status').filter({ hasText: 'Deleted playbook renamed' }).waitFor()
  await control({ delayRead: true })
  await click('Edit')
  await pendingCount(1)
  await click('Switch repository')
  await page.getByText('Seed workflow', { exact: true }).waitFor()
  await release(0)
  await page.waitForFunction(() => window.__playbookCalls.some(call => call.method === 'read' && call.aborted))
  assert.equal(await page.getByLabel('Name', { exact: true }).count(), 0, 'old repository read cannot open editor')
  await click('Edit')
  await pendingCount(2)
  await click('Disable coordination')
  await release(1)
  await click('Enable coordination')
  await page.getByText('Seed workflow', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Name', { exact: true }).count(), 0, 'disabled read cannot restore stale editor')
  await control({ delayRead: false, delayWrite: true })
  await click('New')
  await page.getByLabel('Name', { exact: true }).fill('late-save')
  await click('Save playbook')
  await pendingCount(3)
  await click('Hide manager')
  await release(2)
  await page.waitForFunction(() => window.__playbookCalls.some(call => call.method === 'write' && call.aborted))
  await click('Open manager')
  await page.getByText('Seed workflow', { exact: true }).waitFor()
  assert.equal(await page.getByRole('status').filter({ hasText: 'Saved playbook late-save' }).count(), 0, 'closed write cannot show late success')
  await control({ delayWrite: false })
  await click('Toggle embedded')
  await click('Manage playbooks')
  await click('New')
  await page.getByLabel('Name', { exact: true }).fill('embedded-created')
  await click('Save playbook')
  await page.getByText('Saved playbook embedded-created', { exact: true }).waitFor()
  await click('Back to workflow')
  await page.getByRole('combobox', { name: 'Playbook', exact: true }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: 'Playbook', exact: true }).inputValue(), 'embedded-created')
  await click('Use command host')
  await click('Dispatch playbooks')
  await page.getByRole('dialog', { name: 'Playbooks', exact: true }).waitFor()
  await click('New')
  await page.getByLabel('Name', { exact: true }).fill('command-old-repository')
  await click('Switch repository')
  await click('Save playbook')
  await page.getByRole('status').filter({ hasText: 'Saved playbook command-old-repository' }).waitFor()
  assert.equal(commandWrites.at(-1).cwd, '/fixture/two', 'open repository command keeps its captured target')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Playbooks', exact: true }).waitFor({ state: 'detached' })
  await click('Dispatch playbooks')
  await click('New')
  await page.getByLabel('Name', { exact: true }).fill('command-new-repository')
  await click('Save playbook')
  await page.getByRole('status').filter({ hasText: 'Saved playbook command-new-repository' }).waitFor()
  assert.equal(commandWrites.at(-1).cwd, '/fixture/one', 'new command captures current repository')
  assert.deepEqual(errors, [])
  console.log('Web playbooks: PASS (real PluginSurfaceHost, CRUD, failure, repository switch, disable/re-enable, placement drafts, late close response, embedded Coordination manager and actual repository command host target capture)')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
