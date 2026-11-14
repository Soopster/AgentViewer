import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, realpath, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import * as engine from '../lib/proof/engine.mjs'
const exec = promisify(execFile), temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'proof-web-')))
const cwd = path.join(temporary, 'repo'); await mkdir(cwd)
process.env.AGENT_VIEWER_PROOF_DIR = path.join(temporary, 'data')
const routes = await import('../app/api/proof/route.ts')
let browser, server
try {
  await exec('git', ['init', '-q', cwd])
  await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { pass: 'node -e "for(let i=0;i<20;i++)console.log(\'output-line-\'+i)"', fail: 'node -e "console.error(\'proof failure detail\');process.exit(3)"' } }))
  await build({ entryPoints: ['scripts/webProofBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: path.join(temporary, 'fixture.js'), logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } })
  const script = await readFile(path.join(temporary, 'fixture.js'))
  server = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/proof')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, ...(req.method === 'POST' ? { body: Buffer.concat(chunks), headers: { 'content-type': 'application/json' } } : {}) })
        const response = await routes[req.method](request)
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return
      }
      res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html')
      res.end(req.url === '/fixture.js' ? script : `<!doctype html><html><style>body{font:14px sans-serif;background:#171717;color:#eee}button,select,textarea{margin:4px;padding:6px;background:#292929;color:#eee;border:1px solid #777}pre{white-space:pre-wrap}section{padding:12px}label{display:block}</style><div id="root"></div><script>window.PROOF_CWD=${JSON.stringify(cwd)}</script><script type="module" src="/fixture.js"></script></html>`)
    } catch (error) { res.statusCode = 500; res.end(String(error)) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }); page.setDefaultTimeout(15000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  const base = `http://127.0.0.1:${server.address().port}`
  await page.goto(base)
  await page.getByRole('button', { name: 'Configure checks', exact: true }).click()
  await page.getByRole('button', { name: 'Add pass', exact: true }).click()
  await page.getByRole('button', { name: 'Add fail', exact: true }).click()
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click()
  await page.getByText('Checks saved. Select checks, then run them.', { exact: true }).waitFor()
  assert.equal((await engine.read(cwd)).runs.length, 0, 'configuration must not execute checks')
  await page.getByRole('checkbox').first().check(); await page.getByRole('checkbox').nth(1).check()
  await page.getByRole('button', { name: 'Run selected', exact: true }).click()
  await page.getByRole('button', { name: 'pass · passed · current', exact: true }).waitFor()
  await page.getByRole('button', { name: 'fail · failed · current', exact: true }).waitFor()
  await page.getByRole('button', { name: 'pass · passed · current', exact: true }).click()
  await page.getByRole('button', { name: 'Show all', exact: true }).waitFor()
  assert(!(await page.getByLabel('Verification output').innerText()).includes('output-line-19'))
  await page.getByRole('button', { name: 'Show all', exact: true }).click()
  assert((await page.getByLabel('Verification output').innerText()).includes('output-line-19'))
  await page.getByRole('button', { name: 'fail · failed · current', exact: true }).click()
  await page.getByLabel('Verification output').filter({ hasText: 'proof failure detail' }).waitFor()
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare fix prompt', exact: true }).click()
  assert.equal(await page.getByLabel('Composer draft').inputValue(), 'Keep my existing draft')
  await page.getByText('Select the originating session before preparing its fix prompt.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Original account', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare fix prompt', exact: true }).click()
  assert((await page.getByLabel('Composer draft').inputValue()).startsWith('Keep my existing draft\nFix this verification failure'))
  await writeFile(path.join(cwd, 'new.txt'), 'changed')
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await page.getByRole('button', { name: 'pass · passed · stale', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Relocate Proof', exact: true }).click()
  await page.getByRole('button', { name: 'fail · failed · stale', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Toggle Proof', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle Proof', exact: true }).click()
  await page.getByRole('button', { name: 'pass · passed · stale', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Overlay Proof', exact: true }).click()
  await page.getByRole('dialog', { name: 'Proof', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Proof', exact: true }).waitFor({ state: 'detached' })
  const invalid = await fetch(`${base}/api/proof`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', cwd, ids: ['unknown'], version: (await engine.read(cwd)).config.version }) })
  assert.equal(invalid.status, 400)
  assert.deepEqual(errors, [])
  console.log('Proof Web: PASS (real route + worker, configure, manual execution, receipts, output expansion, stale detection, account-safe composer draft, relocation, remount)')
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }) }
