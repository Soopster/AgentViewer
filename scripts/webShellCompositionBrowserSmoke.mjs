import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-shell-composition-'))
let browser
let server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webShellCompositionBrowserFixture.tsx'], bundle: true,
    platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent' })
  const script = await readFile(bundle)
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install()
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('tab', { name: 'Session Runs', exact: true }).waitFor()
  assert.equal(await page.getByRole('tab', { name: 'Session Runs', exact: true }).getAttribute('aria-selected'), 'true')
  await page.getByRole('button', { name: 'Sessions count 0', exact: true }).click()
  await page.getByRole('tab', { name: 'Messaging', exact: true }).click()
  await page.getByRole('button', { name: 'Messaging count 0', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Sessions count 1', exact: true }).count(), 0)
  await page.getByRole('tab', { name: 'Messaging', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await page.getByRole('button', { name: 'Agents count 0', exact: true }).waitFor()
  assert.equal(await page.getByRole('tab', { name: 'Agent Operations', exact: true }).getAttribute('aria-selected'), 'true')
  await page.getByTitle('Collapse message pane', { exact: true }).click()
  await page.getByTitle('Expand message pane', { exact: true }).waitFor()
  assert.equal(await page.getByRole('navigation', { name: 'Dashboard views' }).count(), 0)
  await page.getByTitle('Expand message pane', { exact: true }).click()
  await page.getByRole('tab', { name: 'Agent Operations', exact: true }).waitFor()

  const panel = page.locator('[data-right-panel]')
  const first = page.locator('[data-right-panel-content="first"]')
  const second = page.locator('[data-right-panel-content="second"]')
  assert.equal(await first.isVisible(), true, 'invalid active IDs show the first surface')
  assert.equal(await second.isVisible(), false)
  assert.equal(await panel.getByRole('button', { name: 'Panel first', exact: true }).getAttribute('aria-pressed'), 'true')
  await first.getByRole('button', { name: 'first count 0', exact: true }).click()
  await panel.getByRole('button', { name: 'Panel second', exact: true }).click()
  await second.getByRole('button', { name: 'second count 0', exact: true }).click()
  await panel.getByRole('button', { name: 'Panel first', exact: true }).click()
  await first.getByRole('button', { name: 'first count 1', exact: true }).waitFor()
  assert.equal(await second.isVisible(), false)
  await panel.getByRole('button', { name: 'Close Panel first', exact: true }).click()
  await second.getByRole('button', { name: 'second count 1', exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: 'Panel second', exact: true }).getAttribute('aria-pressed'), 'true')
  await panel.getByRole('button', { name: 'Close Panel second', exact: true }).click()
  assert.equal(await page.locator('[data-right-panel-content]').count(), 0)
  assert.deepEqual(errors, [])
  console.log('Web shell composition browser: dashboard activation, keyboard navigation, reader collapse, panel fallback, mounted inactive state, and close passed')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
