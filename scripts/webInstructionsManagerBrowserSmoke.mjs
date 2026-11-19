import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { chromium } from 'playwright-core'
import { createInstructionsManager } from '../lib/instructions-manager/service.ts'
const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'instructions-web-'))), cwd = path.join(temp, 'repo'), other = path.join(temp, 'other'), home = path.join(temp, 'home')
for (const root of [cwd, other, home]) await mkdir(path.join(root, '.git'), { recursive: true })
await writeFile(path.join(cwd, 'AGENTS.md'), '# Project conventions\n\nRead @docs/design.md.\n')
await writeFile(path.join(cwd, 'CLAUDE.md'), '# Existing Claude rules\n')
await writeFile(path.join(other, 'AGENTS.md'), '# Other repository\n')
const service = createInstructionsManager(async () => ({ home, environment: {}, instances: [{ id: 'work', provider: 'claude', displayName: 'Work Claude', environment: {} }], dataDir: path.join(temp, 'manager') }))
let browser, server, page
try {
  await build({ entryPoints: ['scripts/webInstructionsManagerBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'fixture.js'), logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } })
  const script = await readFile(path.join(temp, 'fixture.js'))
  const styles = await postcss([tailwind()]).process(await readFile('app/globals.css', 'utf8'), { from: path.resolve('app/globals.css') })
  server = createServer(async (req, res) => {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams
      if (req.url.startsWith('/api/instructions-manager')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null, root = body?.cwd ?? params.get('cwd')
        const result = req.method === 'GET' ? params.get('path') ? await service.read(root, params.get('path')) : await service.scan(root) : body.action === 'preview' ? await service.preview(root, body.change) : await service.apply(root, body.requestId, body.previewHash, body.change, body.replace)
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result })); return
      }
      if (req.url === '/fixture.css') { res.setHeader('content-type', 'text/css'); res.end(styles.css + '\n' + await readFile(path.join(temp, 'fixture.css'), 'utf8')); return }
      res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html')
      res.end(req.url === '/fixture.js' ? script : `<!doctype html><html data-theme="dark"><link rel="stylesheet" href="/fixture.css"><body><div id="root"></div><script>window.INSTRUCTIONS_FIXTURE=${JSON.stringify({ cwd, other })}</script><script type="module" src="/fixture.js"></script></html>`)
    } catch (error) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  page = await browser.newPage({ viewport: { width: 1250, height: 1000 } }); const errors = []
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('heading', { name: 'Project conventions', exact: true }).waitFor()
  await page.screenshot({ path: '/tmp/instructions-browser-populated.png' })
  await page.getByRole('button', { name: 'Show raw', exact: true }).click()
  await page.getByRole('tab', { name: 'Edit', exact: true }).click()
  await page.getByLabel('Instruction text', { exact: true }).fill('# Updated project conventions\n\nKeep provider accounts explicit.\n')
  await page.getByRole('button', { name: 'Relocate', exact: true }).click()
  assert((await page.getByLabel('Instruction text', { exact: true }).inputValue()).includes('Keep provider accounts'))
  await page.getByRole('button', { name: 'Preview save', exact: true }).click()
  await page.getByRole('region', { name: 'Instruction change preview' }).waitFor()
  assert.equal(await readFile(path.join(cwd, 'AGENTS.md'), 'utf8'), '# Project conventions\n\nRead @docs/design.md.\n')
  assert(await page.getByRole('button', { name: 'Apply reviewed change', exact: true }).isDisabled())
  await page.getByRole('checkbox', { name: 'Replace existing instructions and save a backup', exact: true }).check()
  await page.getByRole('button', { name: 'Apply reviewed change', exact: true }).click()
  await page.getByRole('region', { name: 'Instruction history' }).filter({ hasText: 'Backup:' }).waitFor()
  const saved = await readFile(path.join(cwd, 'AGENTS.md'), 'utf8'); assert(saved.includes('Keep provider accounts'))
  await page.getByRole('tab', { name: 'Copy', exact: true }).click()
  await page.getByLabel('Copy destination', { exact: true }).selectOption(path.join(cwd, 'CLAUDE.md'))
  await page.getByRole('button', { name: 'Preview copy', exact: true }).click()
  await page.getByLabel('Before instructions').filter({ hasText: 'Existing Claude rules' }).waitFor()
  await page.getByRole('checkbox', { name: 'Replace existing instructions and save a backup', exact: true }).check()
  await page.getByRole('button', { name: 'Apply reviewed change', exact: true }).click()
  await page.getByRole('region', { name: 'Instruction history' }).filter({ hasText: 'CLAUDE.md' }).waitFor()
  assert.equal(await readFile(path.join(cwd, 'CLAUDE.md'), 'utf8'), saved)
  assert.equal(await readFile(path.join(cwd, 'AGENTS.md'), 'utf8'), saved)
  await page.getByLabel('New rule path', { exact: true }).fill('.claude/rules/browser.md')
  await page.getByRole('button', { name: 'Open or create rule', exact: true }).click()
  await page.getByLabel('Instruction text', { exact: true }).fill('---\npaths: ["src/**"]\n---\n# Browser rule\n')
  await page.getByRole('button', { name: 'Preview save', exact: true }).click()
  await page.getByRole('button', { name: 'Apply reviewed change', exact: true }).click()
  await page.getByRole('region', { name: 'Instruction history' }).filter({ hasText: 'created' }).waitFor()
  assert((await readFile(path.join(cwd, '.claude/rules/browser.md'), 'utf8')).includes('Browser rule'))
  await page.getByRole('button', { name: 'Switch repository', exact: true }).click()
  await page.getByRole('heading', { name: 'Other repository', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Switch repository', exact: true }).click()
  await page.getByRole('tab', { name: 'Read', exact: true }).click()
  await page.getByRole('heading', { name: 'Browser rule', exact: true }).waitFor()
  await page.setViewportSize({ width: 520, height: 900 })
  await page.screenshot({ path: '/tmp/instructions-browser-narrow.png' })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.getByLabel('Search instructions', { exact: true }).fill('no-such-file')
  assert.equal(await page.getByRole('region', { name: 'Instruction files' }).getByRole('button', { pressed: true }).count(), 0)
  await page.getByRole('button', { name: 'Overlay', exact: true }).click()
  await page.getByRole('dialog', { name: 'Instructions Manager', exact: true }).waitFor()
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0)
  assert.deepEqual(errors, [])
  console.log('Instructions Manager browser: PASS (rich/raw reading, drafts through relocation, preview-only preparation, replacement gate, real saves/backups/copies, new rule, repository isolation, narrow view, overlay Escape)')
} catch (error) { console.error((await page?.locator('body').innerText())?.slice(0, 8000)); await page?.screenshot({ path: '/tmp/instructions-browser-failure.png' }); throw error } finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }) }
