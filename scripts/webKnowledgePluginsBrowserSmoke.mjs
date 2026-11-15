import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { createProjectMemory } from '../lib/project-memory/service.ts'
import { projectMemoryContext } from '../lib/plugins/projectMemory.ts'
import { listRunPlaybooks, loadRunPlaybook, writeRunPlaybook } from '../lib/agentCoordination.ts'
const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'knowledge-web-'))), cwd = path.join(temp, 'repo'); await mkdir(cwd)
const memory = createProjectMemory(() => path.join(temp, 'memory'))
let browser, server
try {
  await build({ entryPoints: ['scripts/webKnowledgePluginsBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: path.join(temp, 'fixture.js'), logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } })
  const script = await readFile(path.join(temp, 'fixture.js'))
  server = createServer(async (req, res) => {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams
      if (req.url.startsWith('/api/project-memory')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
        const result = req.method === 'GET' ? await memory.read(cwd) : await memory.mutate(cwd, body.requestId, body.operation)
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result })); return
      }
      if (req.url.startsWith('/api/agent-protocol/playbooks')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
        const result = req.method === 'PUT' ? await writeRunPlaybook(cwd, body.playbook, body.previousName) : params.get('name') ? { playbook: await loadRunPlaybook(cwd, params.get('name')) } : await listRunPlaybooks(cwd)
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result)); return
      }
      res.setHeader('content-type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html')
      res.end(req.url === '/fixture.js' ? script : `<!doctype html><html><style>body{font:14px sans-serif;background:#181818;color:#eee}button,input,select,textarea{margin:4px;padding:6px;background:#292929;color:#eee;border:1px solid #777}section{padding:10px}label{display:block}pre{white-space:pre-wrap}</style><div id="root"></div><script>window.KNOWLEDGE_CWD=${JSON.stringify(cwd)}</script><script type="module" src="/fixture.js"></script></html>`)
    } catch (error) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1250, height: 1100 } }), errors = []; page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByLabel('Note title', { exact: true }).fill('Scoped services')
  await page.getByLabel('Memory text', { exact: true }).fill('Capture session identity before awaiting an action.')
  await page.getByRole('checkbox', { name: 'Pin for recall even without a keyword match', exact: true }).check()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByText('Saved as a draft. Approve it before automatic recall.', { exact: true }).waitFor()
  assert.equal((await memory.read(cwd)).notes[0].reviewed, false)
  await page.getByRole('button', { name: 'Approve note', exact: true }).click()
  await page.getByText('Note approved for recall.', { exact: true }).waitFor()
  await page.getByRole('checkbox', { name: 'Recall approved memory on new turns', exact: true }).click()
  await page.getByText('Automatic recall enabled for this project.', { exact: true }).waitFor()
  assert(projectMemoryContext(await memory.read(cwd), 'anything').includes('Capture session identity'))
  await page.getByRole('button', { name: 'Capture latest reply', exact: true }).click()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByRole('button', { name: 'Open source conversation', exact: true }).click()
  await page.getByLabel('Opened source').filter({ hasText: '"providerInstanceId":"work"' }).waitFor()
  assert((await memory.read(cwd)).notes.some(note => note.source?.messageUuid === 'source-reply'))
  await page.getByRole('button', { name: 'Workflow view', exact: true }).click()
  await page.getByRole('button', { name: 'Preview installation', exact: true }).click()
  await page.getByRole('region', { name: 'Pack installation preview' }).filter({ hasText: 'missing' }).waitFor()
  assert.equal((await listRunPlaybooks(cwd)).playbooks.length, 0)
  await page.getByRole('button', { name: 'Install missing workflows', exact: true }).click()
  await page.getByText('Installed 1; kept 0 existing workflows.', { exact: true }).waitFor()
  assert.equal((await loadRunPlaybook(cwd, 'pack-deliberate-development')).phases.length, 4)
  assert(await page.getByRole('button', { name: 'Install missing workflows', exact: true }).isDisabled())
  await page.getByLabel('Workflow pack', { exact: true }).selectOption('import')
  await page.getByLabel('Pack JSON', { exact: true }).fill('{invalid')
  assert(await page.getByRole('button', { name: 'Install missing workflows', exact: true }).count() === 0)
  const imported = { id: 'local-pack', title: 'Local pack', version: '1.0.0', playbooks: [{ name: 'pack-local-example', gateCommand: 'echo CHECK_ONLY_WHEN_RUN', phases: [{ title: 'Inspect', tasks: [{ title: 'Read task', detail: 'Read {{args}} without changing files.', role: 'lead' }] }] }] }
  await page.getByLabel('Pack JSON', { exact: true }).fill(JSON.stringify(imported))
  await page.getByText('Gate: echo CHECK_ONLY_WHEN_RUN', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Preview installation', exact: true }).click(); await page.getByRole('button', { name: 'Install missing workflows', exact: true }).click()
  await page.getByText('Installed 1; kept 0 existing workflows.', { exact: true }).waitFor()
  assert.equal((await loadRunPlaybook(cwd, 'pack-local-example')).gateCommand, 'echo CHECK_ONLY_WHEN_RUN')
  await page.getByRole('button', { name: 'Memory view', exact: true }).click()
  await page.getByRole('button', { name: /Scoped services/ }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Knowledge plugins browser: PASS (memory drafts/approval/opt-in recall, source identity, reopen, real playbook install, JSON import, declared commands, no automatic runs)')
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }) }
