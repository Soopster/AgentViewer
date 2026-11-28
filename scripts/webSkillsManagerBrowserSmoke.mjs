import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, lstat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { createSkillsManager } from '../lib/skills-manager/service.ts'
const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'skills-web-'))), cwd = path.join(temp, 'repo'), home = path.join(temp, 'home'), source = path.join(home, '.claude', 'skills', 'example'), work = path.join(home, 'work')
await mkdir(cwd); await mkdir(path.join(source, 'references'), { recursive: true }); await mkdir(path.join(source, 'scripts'))
const original = '---\nname: example\ndescription: Browser fixture skill\n---\n# Example\nUse the references.'
await writeFile(path.join(source, 'SKILL.md'), original); await writeFile(path.join(source, 'references', 'guide.md'), 'Original guide'); await writeFile(path.join(source, 'scripts', 'run.sh'), '#!/bin/sh\necho NOT_EXECUTED')
const service = createSkillsManager(async () => ({ home, environment: { HOME: home, XDG_CONFIG_HOME: path.join(home, '.config') }, dataDir: path.join(temp, 'state'), instances: [{ id: 'claude', provider: 'claude', displayName: 'Claude', environment: {} }, { id: 'work', provider: 'claude', displayName: 'Claude Work', environment: { CLAUDE_CONFIG_DIR: work } }] }))
const initial = await service.scan(cwd), sourceRoot = initial.roots.find(root => root.path === path.dirname(source)), targetRoot = initial.roots.find(root => root.path === path.join(work, 'skills'))
assert(sourceRoot && targetRoot)
let browser, server
try {
  await build({ entryPoints: ['scripts/webSkillsManagerBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'fixture.js'), logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } })
  const script = await readFile(path.join(temp, 'fixture.js'))
  server = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/skills-manager')) {
        const params = new URL(req.url, 'http://localhost').searchParams, chunks = []; for await (const chunk of req) chunks.push(chunk)
        const body = req.method === 'GET' ? Object.fromEntries(params) : JSON.parse(Buffer.concat(chunks).toString())
        const result = body.action === 'scan' ? await service.scan(cwd) : body.action === 'file' ? await service.file(cwd, body.skillId, body.file) : body.action === 'preview' ? await service.preview(cwd, body.input) : await service.apply(cwd, body.input)
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result })); return
      }
      res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html')
      res.end(req.url === '/fixture.js' ? script : `<!doctype html><html><style>body{font:14px sans-serif;background:#181818;color:#eee}button,input,select{margin:4px;padding:6px;background:#292929;color:#eee;border:1px solid #777}section{padding:10px}label{display:block}pre{max-height:300px;overflow:auto}</style><div id="root"></div><script>window.SKILLS_CWD=${JSON.stringify(cwd)}</script><script type="module" src="/fixture.js"></script></html>`)
    } catch (error) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1300, height: 1100 } }), errors = []; page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByLabel('Source location', { exact: true }).selectOption(sourceRoot.id)
  await page.getByLabel('Skill resource preview').filter({ hasText: '# Example' }).waitFor()
  await page.getByLabel('Skill resource', { exact: true }).selectOption('scripts/run.sh')
  await page.getByLabel('Skill resource preview').filter({ hasText: 'NOT_EXECUTED' }).waitFor()
  await page.getByRole('checkbox', { name: 'Copy to Claude Work user skills user', exact: true }).check()
  await page.getByRole('button', { name: 'Preview copy', exact: true }).click()
  await page.getByRole('region', { name: 'Copy preview' }).waitFor()
  assert(!existsSync(path.join(work, 'skills', 'example')))
  await page.getByRole('button', { name: 'Apply copies', exact: true }).click()
  await page.getByText('Skills copied. Reload skills or start a new provider session to use the changes.', { exact: true }).waitFor()
  assert(!(await lstat(path.join(work, 'skills', 'example'))).isSymbolicLink())
  assert.equal(await readFile(path.join(work, 'skills', 'example', 'references', 'guide.md'), 'utf8'), 'Original guide')
  await writeFile(path.join(source, 'references', 'guide.md'), 'Updated guide')
  await page.getByRole('button', { name: 'Refresh skills', exact: true }).click()
  await page.getByRole('button', { name: 'Preview copy', exact: true }).click()
  await page.getByRole('checkbox', { name: `Replace existing skill ${targetRoot.id}`, exact: true }).waitFor()
  assert(await page.getByRole('button', { name: 'Apply copies', exact: true }).isDisabled())
  await page.getByRole('checkbox', { name: `Replace existing skill ${targetRoot.id}`, exact: true }).check()
  await page.getByRole('button', { name: 'Apply copies', exact: true }).click()
  await page.getByText('Skills copied. Reload skills or start a new provider session to use the changes.', { exact: true }).waitFor()
  assert.equal(await readFile(path.join(work, 'skills', 'example', 'references', 'guide.md'), 'utf8'), 'Updated guide')
  const receipts = (await service.scan(cwd)).receipts, replacedReceipt = receipts.find(receipt => receipt.results.some(result => result.backup))
  assert(replacedReceipt)
  const backup = replacedReceipt.results.find(result => result.backup)?.backup; assert(backup)
  assert.equal(await readFile(path.join(backup, 'references', 'guide.md'), 'utf8'), 'Original guide')
  await page.getByRole('button', { name: 'Relocate manager', exact: true }).click()
  await page.getByLabel('Skill resource preview').filter({ hasText: 'NOT_EXECUTED' }).waitFor()
  await page.getByRole('button', { name: 'Toggle manager', exact: true }).click(); await page.getByRole('button', { name: 'Toggle manager', exact: true }).click()
  await page.getByText('Recent copies', { exact: true }).click(); await page.getByText(`Backup: ${backup}`, { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Overlay manager', exact: true }).click(); await page.getByRole('dialog', { name: 'Skills Manager', exact: true }).waitFor(); await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'Skills Manager', exact: true }).waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  console.log('Skills Manager browser: PASS (real filesystem copies, resources, preview, explicit replacement, backups, accounts, relocation, reopen, overlay)')
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }) }
