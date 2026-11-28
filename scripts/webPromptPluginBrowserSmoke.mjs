import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const directory = await mkdtemp(path.join(tmpdir(), 'web-prompt-plugin-'))
let browser, server
try {
  const bundle = path.join(directory, 'fixture.js')
  await build({ entryPoints: ['scripts/webPromptPluginBrowserFixture.tsx'], bundle: true,
    platform: 'browser', jsx: 'automatic', outfile: bundle, logLevel: 'silent',
    plugins: [{ name: 'isolated-plugin-registry', setup(build) {
      // Use the real host/registry, isolating this view from unrelated optional modules.
      build.onLoad({ filter: /components\/shell\/pluginViews\.ts$/ }, () => ({
        resolveDir: process.cwd(), loader: 'ts', contents: `
          import { createPluginViewRegistry } from './lib/plugins/activation'
          import { manifest } from './plugins/prompt-library/manifest'
          globalThis.__promptLoads = 0
          export const webPluginViews = createPluginViewRegistry('web', {
            'prompt-library': async () => { globalThis.__promptLoads++; return (await import('./plugins/prompt-library/web')).module }
          }, ['composer', 'session'], [manifest])`,
      }))
    } }],
  })
  const script = await readFile(bundle)
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/fixture.js' ? script : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>')
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const prompt = { slug: 'review', title: 'Review fixture', description: 'A template', tags: [], providers: [], createdAt: '', updatedAt: '', preview: 'Review {{file}}', placeholders: ['file'] }
  let holdReads = false, releaseRead, readStarted
  const pendingRead = new Promise(resolve => { readStarted = resolve })
  await page.route('**/api/prompts**', async route => {
    if (route.request().url().endsWith('/api/prompts')) return route.fulfill({ json: { prompts: [prompt] } })
    if (holdReads) {
      await new Promise(resolve => { releaseRead = resolve; readStarted() })
      return route.fulfill({ json: { prompt: { meta: prompt, body: 'MUST NOT INSERT AFTER CLOSE', placeholders: [] } } })
    }
    return route.fulfill({ json: { prompt: { meta: prompt, body: 'Review {{file}} carefully.', placeholders: ['file'] } } })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: 'Prompt library', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => globalThis.__promptLoads), 0)
  await page.getByRole('button', { name: 'Prompt library', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Prompt library', exact: true })
  await dialog.getByText('Review fixture', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => globalThis.__promptLoads), 1)
  await dialog.getByTitle('New prompt', { exact: true }).click()
  await dialog.locator('input').first().fill('Unsaved placement draft')
  await page.getByRole('button', { name: 'Move placement' }).click()
  assert.equal(await dialog.locator('input').first().inputValue(), 'Unsaved placement draft')
  await page.getByRole('button', { name: 'Move placement' }).click()
  assert.equal(await dialog.locator('input').first().inputValue(), 'Unsaved placement draft')
  await dialog.locator('input').first().press('Escape')
  await dialog.getByText('Review fixture', { exact: true }).click()
  await dialog.getByText('Fill in placeholders', { exact: true }).waitFor()
  await dialog.locator('input').fill('README.md')
  await dialog.locator('input').press('Control+Enter')
  await dialog.waitFor({ state: 'detached' })
  assert.equal(await page.getByTestId('inserted').textContent(), 'Review README.md carefully.')
  await page.getByRole('button', { name: 'Disable plugin' }).click()
  assert.equal(await page.getByRole('button', { name: 'Prompt library', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Enable plugin' }).click()
  await page.getByRole('button', { name: 'Prompt library', exact: true }).click()
  await dialog.getByText('Review fixture', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => globalThis.__promptLoads), 2)
  holdReads = true
  await dialog.getByText('Review fixture', { exact: true }).click()
  await pendingRead
  await dialog.getByTitle('Close (esc)', { exact: true }).click()
  await dialog.waitFor({ state: 'detached' })
  releaseRead()
  await page.waitForTimeout(200)
  assert.equal(await page.getByTestId('inserted').textContent(), 'Review README.md carefully.', 'a late read after close cannot insert into the composer')
  assert.deepEqual(errors, [])
  console.log('Web prompt plugin: PASS (lazy command, placement draft retention, template fill/insertion, disable/re-enable, late-read isolation)')
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
