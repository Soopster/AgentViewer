import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import * as engine from '../lib/proof/engine.mjs'
const exec = promisify(execFile), tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'proof-smoke-')))
const root = path.join(tmp, 'repo'), worker = path.resolve('lib/proof/worker.mjs'), rpc = path.resolve('lib/proof/rpc.mjs')
process.env.AGENT_VIEWER_PROOF_DIR = path.join(tmp, 'data')
const git = (...args) => exec('git', ['-C', root, ...args])
const check = (id, script, timeoutMs = 5000) => ({ id, label: id, executable: process.execPath, args: ['-e', script], cwd: '.', timeoutMs })
const call = async (action, payload) => {
  const { stdout } = await exec(process.execPath, [rpc, action, JSON.stringify(payload)], { env: process.env })
  return JSON.parse(stdout).result
}
async function settled(id) {
  for (let i = 0; i < 250; i++) { const run = await engine.readRun(root, id); if (run.finishedAt) return run; await delay(40) }
  throw new Error('Verification did not settle')
}
let active
try {
  await mkdir(root); await git('init', '-q'); await git('config', 'user.email', 'proof@example.invalid'); await git('config', 'user.name', 'Proof smoke')
  await writeFile(path.join(root, 'source.txt'), 'initial'); await git('add', '.'); await git('commit', '-qm', 'initial')
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'echo test', build: 'echo build' } }))
  let snap = await engine.read(root); assert.equal(snap.config.version, '0'); assert.equal(snap.fingerprint, null); assert.equal(snap.suggestions.length, 2)
  const initial = await engine.fingerprint(root)
  await writeFile(path.join(root, 'source.txt'), 'edited'); assert.notEqual(await engine.fingerprint(root), initial)
  await git('add', 'source.txt'); const staged = await engine.fingerprint(root)
  await git('reset', '-q', 'HEAD', 'source.txt'); assert.notEqual(await engine.fingerprint(root), staged)
  await writeFile(path.join(root, 'source.txt'), 'initial'); assert.equal(await engine.fingerprint(root), initial)
  await git('switch', '-qc', 'another'); assert.notEqual(await engine.fingerprint(root), initial); await git('switch', '-q', '-')
  await writeFile(path.join(root, 'new.txt'), 'new'); assert.notEqual(await engine.fingerprint(root), initial); await rm(path.join(root, 'new.txt'))
  await rm(path.join(root, 'source.txt')); assert.notEqual(await engine.fingerprint(root), initial); await writeFile(path.join(root, 'source.txt'), 'initial')
  await assert.rejects(engine.configure(root, [check('x', ''), check('x', '')], '0'), /unique/)
  await assert.rejects(engine.configure(root, [{ ...check('x', ''), id: undefined }], '0'), /unique/)
  await assert.rejects(engine.configure(root, [{ ...check('x', ''), cwd: '..' }], '0'), /inside/)
  await mkdir(path.join(tmp, 'outside')); await symlink(path.join(tmp, 'outside'), path.join(root, 'escape'))
  await assert.rejects(engine.configure(root, [{ ...check('x', ''), cwd: 'escape' }], '0'), /outside/); await rm(path.join(root, 'escape'))
  const checks = [check('success', 'console.log("passed")'), check('failure', 'console.error("failed");process.exit(2)'), { ...check('missing', ''), executable: 'proof-missing-executable-123' }, check('timeout', 'setInterval(()=>{},1000)', 150), check('bounded', 'process.stdout.write("x".repeat(1200000))'), check('unstable', 'require("node:fs").writeFileSync("source.txt","changed in check")')]
  let cfg = await engine.configure(root, checks, '0')
  await assert.rejects(engine.configure(root, checks, '0'), /changed/)
  await assert.rejects(engine.start(root, ['unknown'], cfg.version, null, worker), /Unknown/)
  await assert.rejects(engine.start(root, ['success'], 'old', null, worker), /changed/)
  active = await engine.start(root, checks.map(check => check.id), cfg.version, { provider: 'codex', providerInstanceId: 'personal', sessionId: 'same-id' }, worker)
  await assert.rejects(engine.start(root, ['success'], cfg.version, null, worker), /active/)
  const run = await settled(active.id); active = null
  assert.deepEqual(run.results.map(result => result.status), ['passed', 'failed', 'failed', 'timeout', 'passed', 'passed'])
  assert.equal(run.results[1].exitCode, 2); assert.equal(run.origin.providerInstanceId, 'personal')
  assert.equal(run.results[4].truncated, true); assert.equal((await engine.output(root, run.id, 'bounded')).length, engine.MAX_OUTPUT)
  assert.notEqual(run.results[5].before, run.results[5].after)
  await assert.rejects(engine.output(root, run.id, '../escape'), /Unknown/)
  assert.equal((await engine.output(root, run.id, 'success')).trim(), 'passed')
  // Each RPC invocation exits; its accepted run continues in a separate worker.
  cfg = await engine.configure(root, [check('wait', `require('node:child_process').spawn(process.execPath,['-e', "setTimeout(()=>require('node:fs').writeFileSync('orphan-marker','orphan'),700)"],{stdio:'ignore'});console.log('started');setInterval(()=>{},1000)`, 15000)], cfg.version)
  active = await call('start', { cwd: root, ids: ['wait'], version: cfg.version })
  const duplicate = await Promise.allSettled([call('start', { cwd: root, ids: ['wait'], version: cfg.version }), call('start', { cwd: root, ids: ['wait'], version: cfg.version })])
  assert(duplicate.every(result => result.status === 'rejected'))
  await delay(150); await call('cancel', { cwd: root, id: active.id })
  assert.equal((await settled(active.id)).results[0].status, 'cancelled'); active = null
  await delay(800); await assert.rejects((await import('node:fs/promises')).access(path.join(root, 'orphan-marker')), /ENOENT/)
  // Recover a worker that died, preserving the receipt instead of treating it as a pass.
  const orphan = { id: 'orphan', cwd: root, createdAt: Date.now() - 20_000, configVersion: cfg.version, pid: 2147483647, results: [{ check: checks[0], status: 'running' }] }
  await engine.saveRun(root, orphan)
  snap = await engine.read(root); assert.equal(snap.runs.find(run => run.id === orphan.id)?.results[0].status, 'interrupted')
  // Retention keeps receipts bounded and removes associated logs.
  for (let i = 0; i < 101; i++) await engine.saveRun(root, { ...orphan, id: `old-${i}`, createdAt: i, finishedAt: i + 1, results: [{ ...orphan.results[0], status: 'passed' }] })
  cfg = await engine.configure(root, [check('success', 'console.log("last")')], cfg.version)
  active = await engine.start(root, ['success'], cfg.version, null, worker); await settled(active.id); active = null
  const { readdir } = await import('node:fs/promises'); assert.equal((await readdir(path.join(engine.storage(root), 'runs'))).length, 100)
  // Multiple worktrees keep independent locks and histories.
  const other = path.join(tmp, 'other'); await git('worktree', 'add', '-qb', 'other', other)
  assert.notEqual(engine.storage(root), engine.storage(await engine.repository(other)))
  console.log('Proof domain: PASS (fingerprints, configuration, detached execution, failure, timeout, cancellation, output bounds, process locking, recovery, worktree isolation)')
} catch (error) { console.error('Original failure:', error); throw error } finally {
  if (active) { await engine.cancel(root, active.id); await settled(active.id) }
  await rm(tmp, { recursive: true, force: true })
}
