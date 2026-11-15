import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, realpath, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { publishPlan, readPlans } from '../lib/plan-review/store.ts'
import { nativePlanReview, deliverPlan, resolvePlanFile } from '../lib/plan-review/service.ts'
const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'plan-review-web-'))), cwd = path.join(temporary, 'repo')
await mkdir(cwd); process.env.AGENT_VIEWER_PLAN_REVIEW_DIR = path.join(temporary, 'data')
const source = { kind: 'message', target: { provider: 'codex', providerInstanceId: 'work', sessionId: 'review-session' }, messageId: 'm1', automatic: true }
const initial = '# Safe API change\n\nKeep the API compatible.\n\nUse **bounded** retries.\n\nAdd focused tests.\n'
await publishPlan(cwd, source, initial)
await writeFile(path.join(cwd, 'manual.md'), '# File review\n\nA file plan.')
let browser, server, deliveries = []
try {
  await build({ entryPoints: ['scripts/webPlanReviewBrowserFixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: path.join(temporary, 'fixture.js'), logLevel: 'silent', define: { 'process.env.NODE_ENV': '"development"' } })
  const script = await readFile(path.join(temporary, 'fixture.js'))
  server = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/plan-review')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const params = new URL(req.url, 'http://localhost').searchParams
        const body = req.method === 'GET' ? { action: params.get('action') } : JSON.parse(Buffer.concat(chunks).toString())
        let result
        if (body.action === 'read') result = { reviews: await readPlans(cwd) }
        else if (body.action === 'messages') result = [{ id: 'manual-message', text: '# Manual message review\n\nAnother plan.' }]
        else if (body.action === 'open') {
          const selected = body.input.source
          const text = selected.kind === 'file' ? await readFile(await resolvePlanFile(cwd, selected.path), 'utf8') : '# Manual message review\n\nAnother plan.'
          result = await publishPlan(cwd, selected.kind === 'file' ? { ...selected, path: await resolvePlanFile(cwd, selected.path) } : selected, text)
        }
        else if (body.action === 'mutate') result = await nativePlanReview.mutate(cwd, body.input)
        else if (body.action === 'send') result = await deliverPlan(cwd, body.input, async (target, text, action) => { deliveries.push({ target, text, action }) })
        else throw new Error('Unexpected action')
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ result })); return
      }
      res.setHeader('Content-Type', req.url === '/fixture.js' ? 'text/javascript' : 'text/html')
      res.end(req.url === '/fixture.js' ? script : `<!doctype html><html><style>body{font:14px sans-serif;background:#171717;color:#eee}button,select,textarea,input{margin:4px;padding:6px;background:#292929;color:#eee;border:1px solid #777}pre{white-space:pre-wrap}section{padding:12px}label{display:block}mark{background:#f5c451;color:black}</style><div id="root"></div><script>window.PLAN_CWD=${JSON.stringify(cwd)}</script><script type="module" src="/fixture.js"></script></html>`)
    } catch (error) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync(chrome) ? chrome : undefined) })
  const page = await browser.newPage({ viewport: { width: 1300, height: 1100 } }); page.setDefaultTimeout(10000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('heading', { name: 'Plan Review', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Approve', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Implement approved plan', exact: true }).isDisabled().then(value => assert(value))
  // Select text in the rendered Markdown, not just in the source textarea.
  await page.locator('.plan-review-document p').filter({ hasText: 'Keep the API compatible.' }).evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await page.getByLabel('Selected passage').filter({ hasText: 'Keep the API compatible.' }).waitFor()
  await page.getByLabel('Review comment', { exact: true }).fill('Keep existing clients working')
  await page.getByRole('button', { name: 'Save annotation', exact: true }).click()
  await page.getByRole('article').filter({ hasText: 'Keep existing clients working' }).waitFor()
  await page.locator('.plan-review-document p').filter({ hasText: 'Use bounded retries.' }).evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  await page.getByLabel('Selected passage').filter({ hasText: 'Use **bounded** retries.' }).waitFor()
  await page.getByLabel('Review comment', { exact: true }).fill('Cap the retry count')
  await page.getByRole('button', { name: 'Save annotation', exact: true }).click()
  await page.getByRole('article').filter({ hasText: 'Cap the retry count' }).waitFor()
  assert((await page.locator('.plan-review-document mark').allTextContents()).join('').includes('bounded'))
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('button', { name: 'Approved', exact: true }).waitFor()
  assert.equal(deliveries.length, 0, 'approval must not start work')
  await page.getByRole('button', { name: 'Relocate review', exact: true }).click()
  await page.getByRole('article').filter({ hasText: 'Keep existing clients working' }).waitFor()
  await page.getByRole('button', { name: 'Implement approved plan', exact: true }).click()
  await page.getByText('Decision delivered to the source session.', { exact: true }).waitFor()
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].target.target.providerInstanceId, 'work')
  assert(deliveries[0].text.includes(initial) && deliveries[0].text.includes('Keep existing clients working'))
  // A revised plan invalidates approval and preserves matched annotations.
  await publishPlan(cwd, { ...source, messageId: 'm2' }, '# Safe API change\n\nIntroduction.\n\nKeep the API compatible.\n\nUse **bounded** retries.\n\nAdd focused tests.\n')
  await page.getByRole('button', { name: 'Refresh plans', exact: true }).click()
  await page.getByRole('button', { name: 'Approve', exact: true }).waitFor()
  await page.getByRole('article').filter({ hasText: 'Keep existing clients working' }).waitFor()
  await page.getByText('comment · line 5', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Request changes', exact: true }).click()
  await page.getByText('feedback · sent', { exact: true }).waitFor()
  assert.equal(deliveries.length, 2)
  assert(deliveries[1].text.startsWith('PLAN CHANGES REQUESTED.'))
  await page.getByRole('button', { name: 'Toggle review', exact: true }).click(); await page.getByRole('button', { name: 'Toggle review', exact: true }).click()
  await page.getByRole('article').filter({ hasText: 'Keep existing clients working' }).waitFor()
  await page.getByRole('button', { name: 'Overlay review', exact: true }).click()
  await page.getByRole('dialog', { name: 'Plan Review', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Plan Review', exact: true }).waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Toggle review', exact: true }).click()
  await page.getByText('Review a message or Markdown file', { exact: true }).click()
  await page.getByRole('button', { name: 'Load recent messages', exact: true }).click()
  await page.getByRole('button', { name: 'Review message', exact: true }).click()
  await page.locator('.plan-review-document').filter({ hasText: 'Manual message review' }).waitFor()
  await page.getByLabel('Markdown path', { exact: true }).fill('manual.md')
  await page.getByRole('button', { name: 'Open file', exact: true }).click()
  await page.locator('.plan-review-document').filter({ hasText: 'File review' }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Plan Review browser: PASS (rendered selection, annotations, approval separated from implementation, captured account, relocation, revisions, feedback, reopen, overlay focus)')
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }) }
