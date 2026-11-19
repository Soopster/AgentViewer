import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
const directory = await mkdtemp(path.join(tmpdir(), 'web-mod-app-'))
let server, browser
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webModAppBrowserFixture.tsx'], bundle: true, platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent', plugins: [{ name: 'preview-paint-fixture', setup(build) { build.onLoad({ filter: /components\/shell\/sdkCode\.tsx?$/ }, () => ({ loader: 'js', contents: `import React from 'react'; export function CodeViewer({code}) { return React.createElement('pre', {'data-mod-preview': true}, code) }`, resolveDir: process.cwd() })) } }] })
  const script = await readFile(bundle)
  server = createServer((request, response) => { response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html'); response.end(request.url === '/fixture.js' ? script : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>') })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage()
  page.setDefaultTimeout(10_000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/files?**', route => {
    const requested = new URL(route.request().url()).searchParams.get('path')
    const entries = ['a.md', 'z.md'].map(name => ({ name, path: `/fixture/${name}`, kind: 'file', size: 8, modified: 0 }))
    return route.fulfill({ json: requested === '/fixture' ? { kind: 'directory', path: '/fixture', parent: '/', entries, parentEntries: [], truncated: false } : { kind: 'text', path: requested, size: 8, content: requested.endsWith('z.md') ? 'SECOND FILE CONTENT' : 'FIRST FILE CONTENT', truncated: false } })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByText('Live board', { exact: true }).waitFor()
  await page.getByText('Meter 0 running', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Increment', exact: true }).click()
  await page.getByRole('button', { name: 'Change activity', exact: true }).click()
  await page.getByText('Meter 1 needs-input', { exact: true }).waitFor()
  await page.locator('[data-plugin-view="mod-view:browser-mod:board"]').getByText('needs-input', { exact: true }).waitFor().catch(async error => { console.error(await page.locator('body').innerText()); console.error(errors); throw error })
  await page.getByRole('button', { name: 'Git', exact: true }).click()
  await page.getByRole('button', { name: 'Session', exact: true }).click()
  assert.equal(await page.locator('output').textContent(), 'git,two')
  await page.getByRole('button', { name: 'Late action', exact: true }).click()
  await page.getByRole('button', { name: 'Retarget', exact: true }).click()
  await page.getByRole('button', { name: 'Release', exact: true }).click()
  await page.waitForTimeout(120)
  assert.equal(await page.locator('output').textContent(), 'git,two', 'late action cannot navigate after retargeting')
  await page.getByRole('button', { name: 'Show first file', exact: true }).click()
  await page.locator('[data-mod-preview]').getByText('FIRST FILE CONTENT', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Show second file', exact: true }).click()
  await page.locator('[data-mod-preview]').getByText('SECOND FILE CONTENT', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close views', exact: true }).click()
  assert.match(await page.evaluate(async () => { try { await window.savedApp.commands.run('git'); return 'unexpected' } catch (error) { return error.message } }), /closed/)
  assert.deepEqual(errors, [])
  console.log('Web mod app: PASS (StrictMode subscriptions, live data/component updates, component state, qualified navigation, retargeted/closed actions and file destination changes)')
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }) }
